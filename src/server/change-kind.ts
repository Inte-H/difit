import { existsSync } from 'fs';
import { createRequire } from 'module';
import { basename, extname } from 'path';
import { fileURLToPath } from 'url';
import { Language, Parser, type Tree } from 'web-tree-sitter';

import type { ChunkChangeKind, DiffChunk } from '../types/diff.js';

const GRAMMAR_BY_EXTENSION: Record<string, string> = {
  '.ts': 'tree-sitter-typescript/tree-sitter-typescript.wasm',
  '.mts': 'tree-sitter-typescript/tree-sitter-typescript.wasm',
  '.cts': 'tree-sitter-typescript/tree-sitter-typescript.wasm',
  '.tsx': 'tree-sitter-typescript/tree-sitter-tsx.wasm',
  '.js': 'tree-sitter-javascript/tree-sitter-javascript.wasm',
  '.mjs': 'tree-sitter-javascript/tree-sitter-javascript.wasm',
  '.cjs': 'tree-sitter-javascript/tree-sitter-javascript.wasm',
  '.jsx': 'tree-sitter-javascript/tree-sitter-javascript.wasm',
  '.py': 'tree-sitter-python/tree-sitter-python.wasm',
  '.go': 'tree-sitter-go/tree-sitter-go.wasm',
  '.rs': 'tree-sitter-rust/tree-sitter-rust.wasm',
  '.java': 'tree-sitter-java/tree-sitter-java.wasm',
  '.css': 'tree-sitter-css/tree-sitter-css.wasm',
  '.sh': 'tree-sitter-bash/tree-sitter-bash.wasm',
  '.bash': 'tree-sitter-bash/tree-sitter-bash.wasm',
};

export const GRAMMAR_FILES = [...new Set(Object.values(GRAMMAR_BY_EXTENSION))];

// Larger files are left unclassified; each changed run costs one parse of the whole file.
const MAX_CLASSIFIED_FILE_LENGTH = 512 * 1024;
export const MAX_CLASSIFIED_RUNS_PER_FILE = 50;

// Comments that tools read. Changing one changes what the build or the checks do, so it counts as code.
const DIRECTIVE_COMMENT =
  /@ts-|eslint-|oxlint-|biome-ignore|prettier-ignore|istanbul\s|c8\s|v8\s+ignore|@vite-ignore|webpack[A-Z]|@jsx|@flow|@license|@preserve|sourceMappingURL|^\/\/\s*go:|^\/\/\s*\+build|^\/\/export\s|^#!|type:\s*ignore|noqa|pylint:|pyright:|mypy:|fmt:\s*(?:off|on|skip)|isort:|-\*-.*coding|shellcheck|nolint|NOLINT|rustfmt::|clippy::|^\/\/\/\s*<(?:reference|amd-module|amd-dependency)\b|[#@]__(?:PURE|NO_SIDE_EFFECTS)__|@(?:vitest|jest)-environment|deno-lint-ignore|@deno-types/;

const isCommentNode = (type: string) => type === 'comment' || type.endsWith('_comment');

let parserReady: Promise<Parser> | null = null;
const languages = new Map<string, Promise<Language | null>>();

function grammarPath(spec: string): string {
  const bundled = fileURLToPath(new URL(`../tree-sitter/${basename(spec)}`, import.meta.url));
  return existsSync(bundled) ? bundled : createRequire(import.meta.url).resolve(spec);
}

function loadLanguage(spec: string): Promise<Language | null> {
  let loading = languages.get(spec);
  if (!loading) {
    loading = getParser()
      .then(() => Language.load(grammarPath(spec)))
      .catch((error: unknown) => {
        console.warn(`Could not load ${basename(spec)}:`, error);
        return null;
      });
    languages.set(spec, loading);
  }
  return loading;
}

function getParser(): Promise<Parser> {
  parserReady ??= Parser.init().then(() => new Parser());
  return parserReady;
}

export function isClassifiablePath(path: string): boolean {
  return extname(path).toLowerCase() in GRAMMAR_BY_EXTENSION;
}

interface Signatures {
  withComments: string;
  code: string;
}

function signaturesOf(tree: Tree, source: string): Signatures {
  const all: string[] = [];
  const code: string[] = [];
  let position = 0;
  const pushGap = (end: number) => {
    const gap = source.slice(position, end).replace(/\s+/g, '');
    if (gap.length > 0) {
      all.push(`gap:${gap}`);
      code.push(`gap:${gap}`);
    }
  };

  const cursor = tree.walk();
  try {
    for (;;) {
      const type = cursor.nodeType;
      const comment = isCommentNode(type);
      if (comment || !cursor.gotoFirstChild()) {
        pushGap(cursor.startIndex);
        const text = cursor.nodeText;
        all.push(`${type}:${text}`);
        if (!comment || DIRECTIVE_COMMENT.test(text)) code.push(`${type}:${text}`);
        position = cursor.endIndex;
      } else {
        all.push(`(${type}`);
        code.push(`(${type}`);
        continue;
      }
      while (!cursor.gotoNextSibling()) {
        if (!cursor.gotoParent()) {
          pushGap(source.length);
          return { withComments: all.join('\u0000'), code: code.join('\u0000') };
        }
        all.push(')');
        code.push(')');
      }
    }
  } finally {
    cursor.delete();
  }
}

function parseSignatures(parser: Parser, source: string): Signatures | null {
  const tree = parser.parse(source);
  if (!tree) return null;
  try {
    return tree.rootNode.hasError ? null : signaturesOf(tree, source);
  } finally {
    tree.delete();
  }
}

// One block of consecutive deleted and added lines, as 0-based line indexes into each side.
interface ChangedRun {
  chunkIndex: number;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
}

const sameLine = (a: string | undefined, b: string) =>
  a !== undefined && a.replace(/\r$/, '') === b.replace(/\r$/, '');

function changedRunsOf(chunks: DiffChunk[], oldLines: string[], newLines: string[]) {
  const runs: ChangedRun[] = [];
  for (const [chunkIndex, chunk] of chunks.entries()) {
    let oldIndex = (chunk.oldLines === 0 ? chunk.oldStart + 1 : chunk.oldStart) - 1;
    let newIndex = (chunk.newLines === 0 ? chunk.newStart + 1 : chunk.newStart) - 1;
    let open: ChangedRun | null = null;
    for (const line of chunk.lines) {
      if (line.type === 'delete' || line.type === 'add') {
        open ??= { chunkIndex, oldStart: oldIndex, oldCount: 0, newStart: newIndex, newCount: 0 };
        if (line.type === 'delete') {
          if (!sameLine(oldLines[oldIndex], line.content)) return null;
          open.oldCount += 1;
          oldIndex += 1;
        } else {
          if (!sameLine(newLines[newIndex], line.content)) return null;
          open.newCount += 1;
          newIndex += 1;
        }
        continue;
      }
      if (open) runs.push(open);
      open = null;
      if (line.type === 'normal' || line.type === 'context') {
        oldIndex += 1;
        newIndex += 1;
      }
    }
    if (open) runs.push(open);
  }
  return runs;
}

function kindOfChunk(kinds: ChunkChangeKind[]): ChunkChangeKind {
  if (kinds.length === 0) return 'unknown';
  if (kinds.includes('code')) return 'code';
  if (kinds.includes('unknown')) return 'unknown';
  return kinds.includes('comment') ? 'comment' : 'whitespace';
}

// Per chunk, whether its changed lines alter only comments, only whitespace, or the code. Null when
// the file is not in a supported language. Anything the parser cannot settle is 'unknown'.
export async function classifyChunks(
  path: string,
  oldText: string,
  newText: string,
  chunks: DiffChunk[],
): Promise<ChunkChangeKind[] | null> {
  const spec = GRAMMAR_BY_EXTENSION[extname(path).toLowerCase()];
  if (!spec) return null;
  const unknown = (): ChunkChangeKind[] => chunks.map(() => 'unknown');
  if (oldText.length > MAX_CLASSIFIED_FILE_LENGTH || newText.length > MAX_CLASSIFIED_FILE_LENGTH) {
    return unknown();
  }

  const [parser, language] = await Promise.all([getParser(), loadLanguage(spec)]);
  if (!language) return unknown();

  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const runs = changedRunsOf(chunks, oldLines, newLines);
  if (!runs || runs.length > MAX_CLASSIFIED_RUNS_PER_FILE) return unknown();

  parser.setLanguage(language);
  const before = parseSignatures(parser, oldText);
  const after = parseSignatures(parser, newText);
  if (!before || !after) return unknown();

  const runKinds = runs.map((run): ChunkChangeKind => {
    const applied = [
      ...oldLines.slice(0, run.oldStart),
      ...newLines.slice(run.newStart, run.newStart + run.newCount),
      ...oldLines.slice(run.oldStart + run.oldCount),
    ].join('\n');
    const signatures = parseSignatures(parser, applied);
    if (!signatures) return 'unknown';
    if (signatures.withComments === before.withComments) return 'whitespace';
    return signatures.code === before.code ? 'comment' : 'code';
  });

  // Each run was judged alone against the old file. Taking all of them back out of the new file must
  // leave its code unchanged too, or one of them changes code together with another run.
  const neutral = runs.filter(
    (_, index) => runKinds[index] !== 'code' && runKinds[index] !== 'unknown',
  );
  if (neutral.length > 0) {
    const reverted = [...newLines];
    for (const run of [...neutral].reverse()) {
      reverted.splice(
        run.newStart,
        run.newCount,
        ...oldLines.slice(run.oldStart, run.oldStart + run.oldCount),
      );
    }
    const signatures = parseSignatures(parser, reverted.join('\n'));
    if (!signatures || signatures.code !== after.code) {
      for (const [index, kind] of runKinds.entries()) {
        if (kind === 'comment' || kind === 'whitespace') runKinds[index] = 'unknown';
      }
    }
  }

  return chunks.map((_, chunkIndex) =>
    kindOfChunk(runKinds.filter((_, index) => runs[index]?.chunkIndex === chunkIndex)),
  );
}
