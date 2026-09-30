import { isUtf8 } from 'buffer';
import { spawn } from 'child_process';
import { existsSync, promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

import {
  AUTOSQUASH_PREFIX,
  type DirectEditRejection,
  REVIEW_THREAD_TRAILER,
} from '../types/diff.js';

export interface DirectEdit {
  filePath: string;
  // 1-based, inclusive, counted in the reviewed commit's version of the file.
  startLine: number;
  endLine: number;
  // The lines as the reviewer saw them; a mismatch means the view is out of date.
  original: string[];
  replacement: string[];
  threadId: string;
}

export interface ReviewedRange {
  base: string;
  target: string;
}

export type DirectEditResult =
  | { ok: true; sha: string; fixupTarget: string }
  | { ok: false; reason: DirectEditRejection; output?: string };

type Rejected = Extract<DirectEditResult, { ok: false }>;

interface GitRun {
  code: number;
  stdout: Buffer;
  output: string;
}

interface GitOptions {
  input?: Buffer;
  env?: Record<string, string>;
}

const GIT_TIMEOUT_MS = 60_000;

function runGit(repoPath: string, args: string[], options: GitOptions = {}): Promise<GitRun> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('git', args, {
      cwd: repoPath,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...options.env },
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      // SIGTERM lets git remove its lock files on the way out.
      child.kill('SIGTERM');
    }, GIT_TIMEOUT_MS);
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      const out = Buffer.concat(stdout);
      const output = `${out.toString('utf8')}${Buffer.concat(stderr).toString('utf8')}`.trim();
      resolvePromise({
        code: code ?? 1,
        stdout: out,
        output: timedOut ? `${output}\ngit ${args[0]} timed out`.trim() : output,
      });
    });
    child.stdin.end(options.input);
  });
}

async function git(repoPath: string, args: string[], options?: GitOptions): Promise<Buffer> {
  const run = await runGit(repoPath, args, options);
  if (run.code !== 0) {
    throw new Error(`git ${args[0]} failed: ${run.output}`);
  }
  return run.stdout;
}

async function gitText(repoPath: string, args: string[], options?: GitOptions): Promise<string> {
  return (await git(repoPath, args, options)).toString('utf8').trim();
}

const literal = (path: string) => `:(literal)${path}`;

async function readBlob(repoPath: string, commit: string, path: string): Promise<Buffer | null> {
  const run = await runGit(repoPath, ['cat-file', 'blob', `${commit}:${path}`]);
  return run.code === 0 ? run.stdout : null;
}

interface TreeEntry {
  mode: string;
  oid: string;
}

const REGULAR_FILE_MODES = new Set(['100644', '100755']);

async function readTreeEntry(
  repoPath: string,
  commit: string,
  path: string,
): Promise<TreeEntry | null> {
  const listing = (await git(repoPath, ['ls-tree', '-z', commit, '--', path])).toString('utf8');
  for (const entry of listing.split('\0')) {
    const match = /^(\d+) \w+ ([0-9a-f]+)\t(.*)$/s.exec(entry);
    if (match?.[3] === path) return { mode: match[1] ?? '', oid: match[2] ?? '' };
  }
  return null;
}

// Splits after each \n, so every line keeps its own terminator and joining gives the bytes back.
function splitLines(content: Buffer): Buffer[] {
  const lines: Buffer[] = [];
  let start = 0;
  for (let index = content.indexOf(10); index !== -1; index = content.indexOf(10, start)) {
    lines.push(content.subarray(start, index + 1));
    start = index + 1;
  }
  if (start < content.length) lines.push(content.subarray(start));
  return lines;
}

const TERMINATOR = /\r?\n?$/;
const terminatorOf = (line: Buffer) => TERMINATOR.exec(line.toString('utf8'))?.[0] ?? '';
const withoutTerminator = (line: Buffer) => line.toString('utf8').replace(TERMINATOR, '');
const withoutCarriageReturn = (line: string) => line.replace(/\r$/, '');

interface EditedFile {
  content: Buffer;
  // The lines the edit actually changed, 1-based and inclusive; never empty.
  startLine: number;
  endLine: number;
}

function applyEdit(content: Buffer, edit: DirectEdit): EditedFile | null {
  const lines = splitLines(content);
  const selected = lines.slice(edit.startLine - 1, edit.endLine);
  if (
    edit.startLine < 1 ||
    edit.endLine > lines.length ||
    selected.length !== edit.original.length ||
    selected.some(
      (line, index) =>
        withoutTerminator(line) !== withoutCarriageReturn(edit.original[index] ?? ''),
    )
  ) {
    return null;
  }

  // Selected lines the edit left as they were keep their bytes, line endings included.
  const replacement = edit.replacement.map(withoutCarriageReturn);
  const keeps = (line: Buffer | undefined, text: string | undefined) =>
    line !== undefined && text !== undefined && withoutTerminator(line) === text;
  let kept = 0;
  while (
    kept < selected.length - 1 &&
    kept < replacement.length &&
    keeps(selected[kept], replacement[kept])
  ) {
    kept += 1;
  }
  let keptAtEnd = 0;
  while (
    kept + keptAtEnd < selected.length - 1 &&
    kept + keptAtEnd < replacement.length &&
    keeps(
      selected[selected.length - 1 - keptAtEnd],
      replacement[replacement.length - 1 - keptAtEnd],
    )
  ) {
    keptAtEnd += 1;
  }
  const start = edit.startLine - 1 + kept;
  const end = edit.endLine - keptAtEnd;
  const changed = lines.slice(start, end);
  const inserted = replacement.slice(kept, replacement.length - keptAtEnd);

  const eol =
    [changed[0], lines[start - 1]]
      .map((line) => (line ? terminatorOf(line) : ''))
      .find((terminator) => terminator.endsWith('\n')) ?? '\n';
  const lastTerminator = terminatorOf(changed[changed.length - 1] ?? Buffer.from('\n'));
  return {
    content: Buffer.concat([
      ...lines.slice(0, start),
      ...inserted.map((line, index) =>
        Buffer.from(line + (index === inserted.length - 1 ? lastTerminator : eol), 'utf8'),
      ),
      ...lines.slice(end),
    ]),
    startLine: start + 1,
    endLine: end,
  };
}

const IN_PROGRESS_MARKERS = [
  'MERGE_HEAD',
  'CHERRY_PICK_HEAD',
  'REVERT_HEAD',
  'rebase-merge',
  'rebase-apply',
];

async function hasOperationInProgress(repoPath: string): Promise<boolean> {
  const paths = (
    await gitText(repoPath, [
      'rev-parse',
      ...IN_PROGRESS_MARKERS.flatMap((marker) => ['--git-path', marker]),
    ])
  ).split('\n');
  return paths.some((path) => existsSync(resolve(repoPath, path)));
}

// The range commit that added the lines, or the reviewed commit when the range left them as they
// were; null when the lines came from more than one commit of the range.
async function findBlamedCommit(
  repoPath: string,
  range: ReviewedRange,
  path: string,
  edited: EditedFile,
): Promise<string | null> {
  const [inRange, blame] = await Promise.all([
    gitText(repoPath, ['rev-list', `${range.base}..${range.target}`]),
    gitText(repoPath, [
      'blame',
      '--porcelain',
      '--no-ignore-revs-file',
      '-L',
      `${edited.startLine},${edited.endLine}`,
      `${range.base}..${range.target}`,
      '--',
      path,
    ]),
  ]);
  const commits = new Set(inRange.split('\n'));
  const authors = new Set(
    blame
      .split('\n')
      .map((line) => /^([0-9a-f]{40,64}) \d+ \d+/.exec(line)?.[1])
      .filter((sha): sha is string => sha !== undefined && commits.has(sha)),
  );
  if (authors.size > 1) return null;
  return [...authors][0] ?? range.target;
}

async function withScratchDir<T>(work: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'difit-direct-edit-'));
  try {
    return await work(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

interface MergedFile {
  merged: Buffer;
  clean: boolean;
}

async function mergeFile(
  dir: string,
  ours: Buffer,
  base: Buffer,
  theirs: Buffer,
): Promise<MergedFile> {
  const [oursPath, basePath, theirsPath] = ['ours', 'base', 'theirs'].map((name) =>
    join(dir, name),
  );
  await Promise.all([
    fs.writeFile(oursPath, ours),
    fs.writeFile(basePath, base),
    fs.writeFile(theirsPath, theirs),
  ]);
  const run = await runGit(dir, ['merge-file', '-p', oursPath, basePath, theirsPath]);
  if (run.code < 0 || run.code > 127) {
    throw new Error(`git merge-file failed: ${run.output}`);
  }
  return { merged: run.stdout, clean: run.code === 0 };
}

interface Change {
  before: Buffer;
  after: Buffer;
}

interface TodoCommit {
  sha: string;
  subject: string;
}

// Resolves a fixup, squash or amend subject the way `rebase --autosquash` does: an exact subject
// first, then a commit id, then a subject prefix.
function squashTarget(earlier: TodoCommit[], subject: string): TodoCommit | undefined {
  if (!AUTOSQUASH_PREFIX.test(subject)) return undefined;
  let named = subject;
  while (AUTOSQUASH_PREFIX.test(named)) named = named.replace(AUTOSQUASH_PREFIX, '');
  return (
    earlier.find((commit) => commit.subject === named) ??
    (/^[0-9a-f]{4,64}$/.test(named)
      ? earlier.find((commit) => commit.sha.startsWith(named))
      : undefined) ??
    earlier.find((commit) => commit.subject.startsWith(named))
  );
}

// The commits in the order `rebase --autosquash` picks them: each commit that names another moves
// behind that commit and the ones already moved there.
function autosquashGroups(commits: TodoCommit[]): TodoCommit[][] {
  const groupOf = new Map<string, TodoCommit[]>();
  const groups: TodoCommit[][] = [];
  commits.forEach((commit, index) => {
    const target = squashTarget(commits.slice(0, index), commit.subject);
    let group = target && groupOf.get(target.sha);
    if (!group) {
      group = [];
      groups.push(group);
    }
    group.push(commit);
    groupOf.set(commit.sha, group);
  });
  return groups;
}

// Replays, for this one file, what autosquash will do from the start of the review: the earliest
// commit from the blamed one onward that the fixup folds into without a conflict. The blamed
// commit is kept when the branch already conflicts without the fixup.
async function findFoldTarget(
  repoPath: string,
  range: ReviewedRange,
  blamed: string,
  head: string,
  path: string,
  fixup: Change,
): Promise<string | null> {
  const [listing, touching, reviewed] = await Promise.all([
    gitText(repoPath, [
      'log',
      '--reverse',
      '--no-merges',
      '--no-show-signature',
      '--encoding=UTF-8',
      '--format=%H%x00%s',
      `${range.base}..${head}`,
    ]),
    gitText(repoPath, ['rev-list', `${range.base}..${head}`, '--', literal(path)]),
    gitText(repoPath, ['rev-list', `${range.base}..${range.target}`]),
  ]);
  const commits = listing
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha = '', subject = ''] = line.split('\0');
      return { sha, subject };
    });
  const touched = new Set(touching.split('\n'));
  const inReview = new Set(reviewed.split('\n'));
  const changes = new Map<string, Change>();
  await Promise.all(
    commits
      .filter((commit) => touched.has(commit.sha))
      .map(async (commit) => {
        const [before, after] = await Promise.all([
          readBlob(repoPath, `${commit.sha}^`, path),
          readBlob(repoPath, commit.sha, path),
        ]);
        changes.set(commit.sha, {
          before: before ?? Buffer.alloc(0),
          after: after ?? Buffer.alloc(0),
        });
      }),
  );
  const groups = autosquashGroups(commits);
  const blamedAt = commits.findIndex((commit) => commit.sha === blamed);
  const candidates = new Set(
    commits
      .filter(
        (commit, index) =>
          commit.sha === blamed ||
          (index > blamedAt && inReview.has(commit.sha) && touched.has(commit.sha)),
      )
      .map((commit) => commit.sha),
  );
  const start = (await readBlob(repoPath, range.base, path)) ?? Buffer.alloc(0);

  return withScratchDir(async (dir) => {
    const replay = async (from: MergedFile, first: number, end?: number): Promise<MergedFile> => {
      let state = from;
      for (const group of groups.slice(first, end)) {
        for (const commit of group) {
          const change = changes.get(commit.sha);
          if (!change) continue;
          state = await mergeFile(dir, state.merged, change.before, change.after);
          if (!state.clean) return state;
        }
      }
      return state;
    };

    if (!(await replay({ merged: start, clean: true }, 0)).clean) return blamed;
    let state: MergedFile = { merged: start, clean: true };
    for (const [index, group] of groups.entries()) {
      state = await replay(state, index, index + 1);
      const candidate = group.find((commit) => candidates.has(commit.sha));
      if (!candidate) continue;
      const folded = await mergeFile(dir, state.merged, fixup.before, fixup.after);
      if (folded.clean && (await replay(folded, index + 1)).clean) return candidate.sha;
    }
    return null;
  });
}

interface FixupCommit {
  head: string;
  sha: string;
  fixupTarget: string;
  mode: string;
  headBlob: string;
  blob: string;
}

// Builds the commit from HEAD's tree in a scratch index, so neither the working tree nor the
// real index is touched and no commit hook runs.
async function writeFixupCommit(
  repoPath: string,
  head: string,
  path: string,
  mode: string,
  content: Buffer,
  message: string[],
): Promise<{ ok: true; sha: string; blob: string } | { ok: false; output: string }> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'difit-direct-edit-index-'));
  const env = { GIT_INDEX_FILE: join(dir, 'index') };
  try {
    await git(repoPath, ['read-tree', head], { env });
    const blob = await gitText(repoPath, ['hash-object', '-w', '--no-filters', '--stdin'], {
      input: content,
    });
    await git(repoPath, ['update-index', '--cacheinfo', mode, blob, path], { env });
    const tree = await gitText(repoPath, ['write-tree'], { env });
    const run = await runGit(repoPath, [
      '-c',
      'i18n.commitEncoding=UTF-8',
      'commit-tree',
      '--no-gpg-sign',
      tree,
      '-p',
      head,
      ...message.flatMap((paragraph) => ['-m', paragraph]),
    ]);
    if (run.code !== 0) return { ok: false, output: run.output };
    return { ok: true, sha: run.stdout.toString('utf8').trim(), blob };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function prepareFixup(
  repoPath: string,
  range: ReviewedRange,
  edit: DirectEdit,
  reviewed: Buffer,
  edited: EditedFile,
  blamed: string,
): Promise<{ ok: true; fixup: FixupCommit } | Rejected> {
  if ((await runGit(repoPath, ['symbolic-ref', '-q', 'HEAD'])).code !== 0) {
    return { ok: false, reason: 'detached-head' };
  }
  const head = await gitText(repoPath, ['rev-parse', '--verify', 'HEAD^{commit}']);
  const onHead = await runGit(repoPath, ['merge-base', '--is-ancestor', range.target, head]);
  if (onHead.code !== 0) return { ok: false, reason: 'target-not-in-head' };
  const headEntry = await readTreeEntry(repoPath, head, edit.filePath);
  if (!headEntry) return { ok: false, reason: 'missing-at-head' };
  if (!REGULAR_FILE_MODES.has(headEntry.mode)) return { ok: false, reason: 'not-a-file' };
  const atHead = await git(repoPath, ['cat-file', 'blob', headEntry.oid]);
  if (atHead.includes(0)) return { ok: false, reason: 'binary' };

  const status = await git(repoPath, ['status', '--porcelain', '-z', '--', literal(edit.filePath)]);
  if (status.length > 0) return { ok: false, reason: 'dirty-file' };
  if (await hasOperationInProgress(repoPath)) return { ok: false, reason: 'operation-in-progress' };

  const { merged, clean } = await withScratchDir((dir) =>
    mergeFile(dir, atHead, reviewed, edited.content),
  );
  if (!clean) return { ok: false, reason: 'conflict' };
  if (merged.equals(atHead)) return { ok: false, reason: 'no-change' };

  const fixupTarget = await findFoldTarget(repoPath, range, blamed, head, edit.filePath, {
    before: atHead,
    after: merged,
  });
  if (!fixupTarget) return { ok: false, reason: 'fold-conflict' };

  const targetSubject = await gitText(repoPath, [
    'log',
    '-1',
    '--no-show-signature',
    '--encoding=UTF-8',
    '--format=%s',
    fixupTarget,
  ]);
  // Autosquash matches a subject to the oldest commit bearing it, and cannot match an empty one.
  const written = await writeFixupCommit(repoPath, head, edit.filePath, headEntry.mode, merged, [
    `fixup! ${fixupTarget}`,
    ...(targetSubject ? [targetSubject] : []),
    `${REVIEW_THREAD_TRAILER}: ${edit.threadId}`,
  ]);
  if (!written.ok) return { ok: false, reason: 'commit-failed', output: written.output };
  return {
    ok: true,
    fixup: {
      head,
      sha: written.sha,
      fixupTarget,
      mode: headEntry.mode,
      headBlob: headEntry.oid,
      blob: written.blob,
    },
  };
}

// Brings the index entry up to the new commit while it still holds the previous HEAD's blob, and
// the file too while it has no changes of its own; anything else is someone's work in progress.
async function syncWorkingTree(repoPath: string, path: string, fixup: FixupCommit) {
  const indexed = (await git(repoPath, ['ls-files', '-s', '-z', '--', literal(path)])).toString(
    'utf8',
  );
  if (/^\d+ ([0-9a-f]+) 0\t/.exec(indexed)?.[1] !== fixup.headBlob) return;
  const changed = await runGit(repoPath, [
    'diff',
    '--quiet',
    '--no-ext-diff',
    '--no-textconv',
    '--',
    literal(path),
  ]);
  // Left at the old blob, the index would stage a revert of the fixup for the next commit.
  await git(repoPath, ['update-index', '--cacheinfo', fixup.mode, fixup.blob, path]);
  if (changed.code !== 0) return;
  const content = await git(repoPath, ['cat-file', '--filters', `--path=${path}`, fixup.blob]);
  await fs.writeFile(join(repoPath, path), content);
}

const MAX_ATTEMPTS = 3;

export async function commitDirectEdit(
  repoPath: string,
  requested: ReviewedRange,
  edit: DirectEdit,
): Promise<DirectEditResult> {
  const range = {
    base: await gitText(repoPath, ['rev-parse', '--verify', `${requested.base}^{commit}`]),
    target: await gitText(repoPath, ['rev-parse', '--verify', `${requested.target}^{commit}`]),
  };
  const reviewedEntry = await readTreeEntry(repoPath, range.target, edit.filePath);
  if (!reviewedEntry) return { ok: false, reason: 'stale-view' };
  if (!REGULAR_FILE_MODES.has(reviewedEntry.mode)) return { ok: false, reason: 'not-a-file' };
  const reviewed = await git(repoPath, ['cat-file', 'blob', reviewedEntry.oid]);
  if (reviewed.includes(0)) return { ok: false, reason: 'binary' };
  if (!isUtf8(reviewed)) return { ok: false, reason: 'not-utf8' };
  const edited = applyEdit(reviewed, edit);
  if (!edited) return { ok: false, reason: 'stale-view' };

  const blamed = await findBlamedCommit(repoPath, range, edit.filePath, edited);
  if (!blamed) return { ok: false, reason: 'mixed-commits' };

  // A commit that lands meanwhile makes the update fail; the edit is then merged onto it afresh,
  // so the fixup never carries that commit's changes backwards.
  let output: string | undefined;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const prepared = await prepareFixup(repoPath, range, edit, reviewed, edited, blamed);
    if (!prepared.ok) return prepared;
    const { fixup } = prepared;
    const moved = await runGit(repoPath, [
      'update-ref',
      '-m',
      `difit: fixup! ${fixup.fixupTarget}`,
      'HEAD',
      fixup.sha,
      fixup.head,
    ]);
    if (moved.code === 0) {
      // The commit is in; a file left behind only shows up in git status.
      await syncWorkingTree(repoPath, edit.filePath, fixup).catch(() => undefined);
      return { ok: true, sha: fixup.sha, fixupTarget: fixup.fixupTarget };
    }
    output = moved.output;
    const headNow = await gitText(repoPath, ['rev-parse', '--verify', 'HEAD^{commit}']);
    if (headNow === fixup.head) return { ok: false, reason: 'commit-failed', output };
  }
  return { ok: false, reason: 'head-moved', ...(output === undefined ? {} : { output }) };
}
