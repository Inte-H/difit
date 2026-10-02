import { spawn } from 'child_process';
import { extname } from 'path';

import { type SymbolMatch, type SymbolSearchResponse } from '../types/diff.js';

const MAX_DEFINITIONS = 200;
const MAX_REFERENCES = 500;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_TEXT_LENGTH = 240;
// Longer lines are minified code or data, and the patterns below get slow on them.
const MAX_DECLARATION_LENGTH = 1000;
// Prose and data files mention names without declaring them.
const NON_CODE_EXTENSIONS = new Set([
  '.md',
  '.mdx',
  '.txt',
  '.rst',
  '.adoc',
  '.json',
  '.lock',
  '.csv',
  '.yml',
  '.yaml',
]);
const GREP_TIMEOUT_MS = 30_000;

const DECLARING_KEYWORDS =
  'function\\*?|def|class|interface|enum|struct|trait|type|typedef|fn|fun|func|record|object|module|namespace|macro|sub|proc|let|const|var|val';

// A word in front of a call that makes the line a statement rather than a declaration.
const STATEMENT_WORDS = new Set([
  'if',
  'elif',
  'while',
  'for',
  'with',
  'switch',
  'catch',
  'when',
  'unless',
  'until',
  'do',
  'raise',
  'defer',
  'go',
  'puts',
  'sizeof',
  'instanceof',
  'try',
  'return',
  'new',
  'await',
  'throw',
  'yield',
  'else',
  'case',
  'typeof',
  'delete',
  'in',
  'of',
  'not',
  'and',
  'or',
  'echo',
  'print',
  'assert',
]);

const IMPORT_LINE = /^\s*(?:import\b|from\s+\S+\s+import\b|export\s+(?:type\s+)?\{|#\s*include\b)/;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Guesses from one line, without parsing, whether it declares `name`.
export function definitionMatcher(name: string): (text: string) => boolean {
  const n = escapeRegExp(name);
  const end = '(?![\\w$])';

  const declaredByKeyword = new RegExp(
    `(?:^|[^\\w$.])(?:${DECLARING_KEYWORDS})\\s+(?:\\([^)]*\\)\\s*)?(?:[\\w$]+\\.)?${n}${end}`,
  );
  const assignedFunction = new RegExp(
    `(?:^|[^\\w$.])${n}\\s*[:=]\\s*(?:async\\s+)?(?:function\\b|\\([^)]*\\)\\s*(?::[^=]*)?=>|[\\w$]+\\s*=>)`,
  );
  // `public static List<Foo> name(`, `void name(int a);`
  const typedSignature = new RegExp(
    `^\\s*(?:@[\\w$.]+(?:\\([^)]*\\))?\\s+)*([\\w$<>\\[\\],?&*:.\\s]*?[\\w$>\\]?*&])\\s+${n}\\s*(?:<[^>]*>)?\\s*\\(`,
  );
  // Method shorthand and shell functions: `name(a, b) {`, `async name(): T {`, `name() {`
  const bareSignature = new RegExp(
    `^\\s*(?:(?:async|static|get|set|public|private|protected|override)\\s+|\\*\\s*)*${n}\\s*(?:<[^>]*>)?\\s*\\([^()]*\\)\\s*(?::\\s*[^{;=]+)?\\{\\s*(?://.*)?$`,
  );

  return (text) => {
    if (IMPORT_LINE.test(text)) return false;
    if (declaredByKeyword.test(text) || assignedFunction.test(text)) return true;
    const typed = typedSignature.exec(text);
    if (typed?.[1] !== undefined && !startsStatement(typed[1])) return true;
    return bareSignature.test(text);
  };
}

// The operators typedSignature's prefix can hold that only ever join expressions.
const STANDALONE_OPERATOR = /^(?:[<>?]+|&&)$/;

function startsStatement(prefix: string): boolean {
  // A standalone operator joins expressions; in a type (`T&&`, `Map<K, ? extends V>`) it is
  // attached to a word or inside type arguments. A lone `&` or `*` can be a spaced reference or
  // pointer type (`const Foo & get(`).
  let typeless = prefix;
  for (let previous = ''; previous !== typeless; ) {
    previous = typeless;
    typeless = typeless.replace(/([\w$])<[^<>]*>/g, '$1');
  }
  const words = typeless.trim().split(/\s+/);
  if (words.some((word) => STANDALONE_OPERATOR.test(word))) return true;
  // A leading label (`public:`, `case X:`, an object key) says nothing; what follows it decides.
  while (words[0]?.endsWith(':')) words.shift();
  if (words.length === 0) return true;
  const [first = '', second = ''] = words.map((word) => word.replace(/\*+$/, ''));
  if (!/^[A-Za-z_$]/.test(first)) return true;
  if (first === 'export' && second === 'default') return true;
  return STATEMENT_WORDS.has(first) || (first === 'async' && STATEMENT_WORDS.has(second));
}

function rank(match: SymbolMatch, from: string | undefined): number {
  if (from === undefined) return 0;
  if (match.path === from) return 0;
  return extname(match.path) === extname(from) ? 1 : 2;
}

function treeArgs(ref: string): string[] {
  if (ref === 'working' || ref === '.') return ['--untracked'];
  if (ref === 'staged') return ['--cached'];
  return [ref];
}

interface GrepOutput {
  stdout: Buffer;
  truncated: boolean;
}

function grep(repoPath: string, args: string[], signal?: AbortSignal): Promise<GrepOutput> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('git', args, {
      signal,
      cwd: repoPath,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    const chunks: Buffer[] = [];
    const stderr: Buffer[] = [];
    let size = 0;
    let truncated = false;
    const timer = setTimeout(() => {
      truncated = true;
      child.kill('SIGTERM');
    }, GREP_TIMEOUT_MS);
    child.stdout.on('data', (chunk: Buffer) => {
      if (truncated) return;
      chunks.push(chunk);
      size += chunk.length;
      if (size >= MAX_OUTPUT_BYTES) {
        truncated = true;
        child.kill('SIGTERM');
      }
    });
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      // git grep exits with 1 when nothing matches.
      if (!truncated && code !== 0 && code !== 1) {
        reject(
          new Error(Buffer.concat(stderr).toString('utf8').trim() || `git grep exited ${code}`),
        );
        return;
      }
      resolvePromise({ stdout: Buffer.concat(chunks), truncated });
    });
  });
}

export async function searchSymbol(
  repoPath: string,
  name: string,
  ref: string,
  from?: string,
  signal?: AbortSignal,
): Promise<SymbolSearchResponse> {
  const tree = treeArgs(ref);
  const output = await grep(
    repoPath,
    [
      'grep',
      '-n',
      '-w',
      '-I',
      '-F',
      '--full-name',
      '--null',
      '--no-color',
      '-e',
      name,
      ...tree,
      '--',
    ],
    signal,
  );

  // With a tree, each record starts with `<ref>:<path>`.
  const prefix = tree[0] === ref ? `${ref}:` : '';
  const records = output.stdout.toString('utf8').split('\n');
  if (output.truncated) records.pop();

  const declares = definitionMatcher(name);
  const definitions: SymbolMatch[] = [];
  const references: SymbolMatch[] = [];
  let truncated = output.truncated;
  for (const record of records) {
    if (record === '') continue;
    const [location, lineNumber, ...rest] = record.split('\0');
    if (location === undefined || lineNumber === undefined) continue;
    const fullText = rest.join('\0');
    const match: SymbolMatch = {
      path: location.startsWith(prefix) ? location.slice(prefix.length) : location,
      line: Number(lineNumber),
      text: fullText.length > MAX_TEXT_LENGTH ? `${fullText.slice(0, MAX_TEXT_LENGTH)}…` : fullText,
    };
    const isDefinition =
      fullText.length <= MAX_DECLARATION_LENGTH &&
      !NON_CODE_EXTENSIONS.has(extname(match.path).toLowerCase()) &&
      declares(fullText);
    if (isDefinition) {
      definitions.push(match);
    } else if (references.length < MAX_REFERENCES) {
      references.push(match);
    } else {
      truncated = true;
    }
  }

  definitions.sort((a, b) => rank(a, from) - rank(b, from));
  if (definitions.length > MAX_DEFINITIONS) truncated = true;
  return {
    name,
    ref,
    definitions: definitions.slice(0, MAX_DEFINITIONS),
    references,
    truncated,
  };
}
