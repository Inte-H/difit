import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { fetch } from 'undici';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';

import { startServer } from './server.js';
import type { DiffResponse } from '../types/diff.js';
import { bindingForView, createDiffSelection } from '../utils/diffSelection.js';

let home: string;
const savedEnv = { ...process.env };
const cleanups: Array<() => Promise<void> | void> = [];

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'difit-fixup-flow-home-'));
  // A test run started from a commit hook would otherwise point every git call at that commit.
  process.env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
  );
  Object.assign(process.env, {
    HOME: home,
    XDG_CONFIG_HOME: home,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'difit',
    GIT_AUTHOR_EMAIL: 'difit@example.com',
    GIT_COMMITTER_NAME: 'difit',
    GIT_COMMITTER_EMAIL: 'difit@example.com',
  });
});

afterAll(() => {
  process.env = savedEnv;
  rmSync(home, { recursive: true, force: true });
});

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function git(repo: string, args: string[], env: NodeJS.ProcessEnv = {}): string {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  }).trim();
}

function commit(repo: string, message: string, files: Record<string, string>): string {
  for (const [path, content] of Object.entries(files)) {
    writeFileSync(join(repo, path), content);
  }
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', message]);
  return git(repo, ['rev-parse', 'HEAD']);
}

const PINNING_TEST = `import { discount } from './discount.js';

test('discount', () => {
  expect(discount(105)).toBe(10.5);
});
`;

it('folds the fixup for a comment made on one commit into that commit', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'difit-fixup-flow-'));
  cleanups.push(() => rmSync(repo, { recursive: true, force: true }));
  git(repo, ['init', '-q']);
  git(repo, ['checkout', '-q', '-b', 'main']);
  const base = commit(repo, 'base', {
    'discount.js': 'export function discount(price) {\n  return price * 0.1;\n}\n',
  });
  const pin = commit(repo, 'test: pin current discount', { 'discount.test.js': PINNING_TEST });
  const fix = commit(repo, 'fix: round discount down', {
    'discount.js': 'export function discount(price) {\n  return Math.floor(price * 0.1);\n}\n',
  });

  const { port, server } = await startServer({
    selection: createDiffSelection(base, fix),
    repoPath: repo,
    preferredPort: 9260,
  });
  cleanups.push(() => new Promise<void>((resolve) => server?.close(() => resolve())));
  const api = (path: string) => `http://localhost:${port}${path}`;
  const text = async (path: string) => (await fetch(api(path))).text();

  const whole = (await (await fetch(api('/api/diff'))).json()) as DiffResponse;
  const review = whole.review!;
  const reviewQuery = `?base=${review.selection.baseCommitish}&target=${review.selection.targetCommitish}`;
  const shown = (await (
    await fetch(api(`/api/diff?base=${base}&target=${pin}`))
  ).json()) as DiffResponse;
  const binding = bindingForView(
    review,
    createDiffSelection(shown.baseCommitish!, shown.targetCommitish!),
  )!;
  const at = '2026-10-19T00:00:00Z';
  await fetch(api(`/api/comments${reviewQuery}`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      threads: [
        {
          id: 't1',
          filePath: 'discount.test.js',
          createdAt: at,
          updatedAt: at,
          position: { side: 'new', line: 3 },
          codeSnapshot: { content: "test('discount', () => {", commit: binding.snapshotCommit },
          view: binding.view,
          fixupTarget: binding.fixupTarget,
          messages: [
            { id: 't1', body: 'Say what it pins.', author: 'User', createdAt: at, updatedAt: at },
          ],
        },
      ],
    }),
  });

  const json = (await (await fetch(api('/api/comments-json'))).json()) as {
    threads: Array<{ view?: unknown; fixupTarget?: string }>;
  };
  expect(json.threads[0]?.view).toEqual({ baseCommitish: base, targetCommitish: pin });
  expect(json.threads[0]?.fixupTarget).toBe(pin);
  const shortPin = git(repo, ['rev-parse', '--short', pin]);
  expect(await text('/api/comments-output')).toContain(
    `discount.test.js:L3 [수정 중]\n고쳐 넣을 커밋: ${shortPin} test: pin current discount\n`,
  );
  expect(await text('/api/comments-wait')).toContain(`"fixupTarget":"${pin}"`);

  writeFileSync(
    join(repo, 'discount.test.js'),
    PINNING_TEST.replace("test('discount'", "test('takes ten percent without rounding'"),
  );
  git(repo, ['commit', '-q', '-a', `--fixup=${pin}`, '--trailer', 'Review-Thread: t1']);
  const fixup = git(repo, ['rev-parse', 'HEAD']);

  const fixups = (await (await fetch(api(`/api/fixups${reviewQuery}`))).json()) as {
    fixups: Array<{ sha: string; threadIds: string[] }>;
  };
  expect(fixups.fixups.map(({ sha, threadIds }) => ({ sha, threadIds }))).toEqual([
    { sha: fixup, threadIds: ['t1'] },
  ]);
  expect(await text('/api/comments-output')).toContain('discount.test.js:L3 [승인 대기]');
  const decide = (decision: Record<string, string>) =>
    fetch(api('/api/decisions'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ threadId: 't1', at: new Date().toISOString(), ...decision }]),
    });
  await decide({ kind: 'approved', fixupSha: fixup });
  expect(await text('/api/comments-output')).toContain('discount.test.js:L3 [승인됨]');

  const before = git(repo, ['rev-parse', 'HEAD']);
  git(repo, ['rebase', '-q', '-i', '--autosquash', base], { GIT_SEQUENCE_EDITOR: ':' });

  expect(git(repo, ['log', '--format=%s', `${base}..HEAD`]).split('\n')).toEqual([
    'fix: round discount down',
    'test: pin current discount',
  ]);
  expect(git(repo, ['diff', '--exit-code', before, 'HEAD'])).toBe('');
  const newPin = git(repo, ['rev-parse', 'HEAD^']);
  expect(git(repo, ['show', newPin, '--', 'discount.test.js'])).toContain(
    "+test('takes ten percent without rounding', () => {",
  );
  expect(git(repo, ['show', '--name-only', '--format=', 'HEAD'])).toBe('discount.js');
  expect(git(repo, ['log', '-1', '--format=%B', newPin])).not.toContain('Review-Thread');

  await decide({ kind: 'folded', fixupSha: fixup, targetSha: newPin });
  expect(await text('/api/comments-output')).toContain('discount.test.js:L3 [접힘]');
});

it('folds the fixups for comments made on a run and on the whole review into the commits that made their lines', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'difit-fixup-flow-'));
  cleanups.push(() => rmSync(repo, { recursive: true, force: true }));
  git(repo, ['init', '-q']);
  git(repo, ['checkout', '-q', '-b', 'main']);
  const base = commit(repo, 'base', {
    'discount.js': 'export function discount(price) {\n  return price * 0.1;\n}\n',
  });
  const pin = commit(repo, 'test: pin current discount', { 'discount.test.js': PINNING_TEST });
  const fix = commit(repo, 'fix: round discount down', {
    'discount.js': 'export function discount(price) {\n  return Math.floor(price * 0.1);\n}\n',
  });
  const docs = commit(repo, 'docs: say discounts round down', { 'README.md': 'Rounds down.\n' });

  const { port, server } = await startServer({
    selection: createDiffSelection(base, docs),
    repoPath: repo,
    preferredPort: 9270,
  });
  cleanups.push(() => new Promise<void>((resolve) => server?.close(() => resolve())));
  const api = (path: string) => `http://localhost:${port}${path}`;

  const whole = (await (await fetch(api('/api/diff'))).json()) as DiffResponse;
  const review = whole.review!;
  const reviewQuery = `?base=${review.selection.baseCommitish}&target=${review.selection.targetCommitish}`;
  const run = (await (
    await fetch(api(`/api/diff?base=${base}&target=${fix}`))
  ).json()) as DiffResponse;
  const bind = async (shown: DiffResponse, path: string, line: number) => {
    const view = createDiffSelection(shown.baseCommitish!, shown.targetCommitish!);
    const params = new URLSearchParams({
      base: view.baseCommitish,
      target: view.targetCommitish,
      path,
      start: String(line),
      end: String(line),
      side: 'new',
    });
    const { fixupTarget } = (await (
      await fetch(api(`/api/fixup-target?${params.toString()}`))
    ).json()) as { fixupTarget: string };
    return bindingForView(review, view, fixupTarget)!;
  };
  const onRun = await bind(run, 'discount.test.js', 3);
  const onWhole = await bind(whole, 'discount.js', 2);
  expect(onRun).toEqual({
    view: { baseCommitish: base, targetCommitish: fix },
    fixupTarget: pin,
    snapshotCommit: fix,
  });
  expect(onWhole).toEqual({ fixupTarget: fix });
  const status = async (query: Record<string, string>) =>
    (await fetch(api(`/api/fixup-target?${new URLSearchParams(query).toString()}`))).status;
  const line = { path: 'discount.js', start: '1', end: '1' };
  expect(await status({ base: docs, target: base, side: 'new', ...line })).toBe(404);
  expect(await status({ base, target: fix, side: 'middle', ...line })).toBe(400);

  const at = '2026-10-20T00:00:00Z';
  const thread = (id: string, filePath: string, line: number, content: string) => ({
    id,
    filePath,
    createdAt: at,
    updatedAt: at,
    position: { side: 'new', line },
    codeSnapshot: { content, commit: docs },
    messages: [{ id, body: 'Fix this.', author: 'User', createdAt: at, updatedAt: at }],
  });
  await fetch(api(`/api/comments${reviewQuery}`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      threads: [
        {
          ...thread('t1', 'discount.test.js', 3, "test('discount', () => {"),
          codeSnapshot: { content: "test('discount', () => {", commit: onRun.snapshotCommit },
          view: onRun.view,
          fixupTarget: onRun.fixupTarget,
        },
        {
          ...thread('t2', 'discount.js', 2, '  return Math.floor(price * 0.1);'),
          fixupTarget: onWhole.fixupTarget,
        },
      ],
    }),
  });

  const json = (await (await fetch(api('/api/comments-json'))).json()) as {
    threads: Array<{ id: string; fixupTarget?: string }>;
  };
  expect(json.threads.map(({ id, fixupTarget }) => ({ id, fixupTarget }))).toEqual([
    { id: 't1', fixupTarget: pin },
    { id: 't2', fixupTarget: fix },
  ]);

  writeFileSync(
    join(repo, 'discount.test.js'),
    PINNING_TEST.replace("test('discount'", "test('takes ten percent without rounding'"),
  );
  git(repo, ['commit', '-q', '-a', `--fixup=${pin}`, '--trailer', 'Review-Thread: t1']);
  writeFileSync(
    join(repo, 'discount.js'),
    'export function discount(price) {\n  return Math.floor(price / 10);\n}\n',
  );
  git(repo, ['commit', '-q', '-a', `--fixup=${fix}`, '--trailer', 'Review-Thread: t2']);
  const before = git(repo, ['rev-parse', 'HEAD']);
  git(repo, ['rebase', '-q', '-i', '--autosquash', base], { GIT_SEQUENCE_EDITOR: ':' });

  expect(git(repo, ['diff', '--exit-code', before, 'HEAD'])).toBe('');
  expect(git(repo, ['log', '--format=%s', `${base}..HEAD`]).split('\n')).toEqual([
    'docs: say discounts round down',
    'fix: round discount down',
    'test: pin current discount',
  ]);
  expect(git(repo, ['show', 'HEAD~2:discount.test.js'])).toContain(
    "test('takes ten percent without rounding'",
  );
  expect(git(repo, ['show', 'HEAD~1:discount.js'])).toContain('Math.floor(price / 10)');
});
