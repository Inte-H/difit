import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { GitDiffParser } from './git-diff';

// Runs against real repositories because the risk is in how git prints many commits in one go.
let home: string;
const savedEnv = { ...process.env };
const repos: string[] = [];

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'difit-fixups-home-'));
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

afterEach(() => {
  for (const repo of repos.splice(0)) {
    rmSync(repo, { recursive: true, force: true });
  }
});

function git(repo: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
}

function createRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), 'difit-fixups-'));
  repos.push(repo);
  git(repo, 'init', '-q');
  git(repo, 'checkout', '-q', '-b', 'main');
  return repo;
}

function commit(
  repo: string,
  message: string,
  files: Record<string, string | Buffer | null> = {},
): string {
  for (const [path, content] of Object.entries(files)) {
    const fullPath = join(repo, path);
    if (content === null) {
      rmSync(fullPath);
    } else {
      mkdirSync(dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, content);
    }
  }
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '--allow-empty', '-m', message);
  return git(repo, 'rev-parse', 'HEAD');
}

function merge(repo: string, branch: string, message: string, strategy?: string): string {
  git(repo, 'merge', '-q', '--no-ff', ...(strategy ? ['-s', strategy] : []), '-m', message, branch);
  return git(repo, 'rev-parse', 'HEAD');
}

// The reference: one `git diff <sha>^ <sha>` per fixup.
function diffAgainstFirstParent(parser: GitDiffParser, repo: string, sha: string) {
  const raw = execFileSync('git', ['diff', `${sha}^`, sha, '--no-ext-diff', '--color=never'], {
    cwd: repo,
    encoding: 'utf8',
  });
  return parser
    .parseStdinDiff(raw)
    .files.map(({ path, oldPath, status, chunks }) => ({ path, oldPath, status, chunks }));
}

function countGitCalls(parser: GitDiffParser): string[] {
  const calls: string[] = [];
  const target = (parser as any).git;
  (parser as any).git = new Proxy(target, {
    get(object, property, receiver) {
      const value = Reflect.get(object, property, receiver);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        calls.push(String(property));
        return value.apply(object, args);
      };
    },
  });
  return calls;
}

const lines = (count: number, prefix: string) =>
  Array.from({ length: count }, (_, index) => `${prefix}${index + 1}`).join('\n') + '\n';

describe('listThreadFixups against a real repository', () => {
  it('reads every fixup the same as a separate git diff against its first parent', async () => {
    const repo = createRepo();
    git(repo, 'config', 'color.ui', 'always');
    git(repo, 'config', 'diff.external', 'echo external diff');
    const binary = Buffer.from([0, 1, 2, 3, 255, 0, 7]);
    commit(repo, 'base', {
      '.gitattributes': '*.raw diff\n',
      'f.txt': lines(10, 'f'),
      'g.txt': lines(10, 'g'),
      'old-name.txt': lines(20, 'moved'),
      'bin.dat': binary,
      'nul.raw': 'plain\n',
      'side.txt': lines(3, 's'),
    });
    const target = git(repo, 'rev-parse', 'HEAD');

    git(repo, 'checkout', '-q', '-b', 'side');
    commit(repo, 'side work', { 'side.txt': lines(3, 's') + 'from side\n' });
    git(repo, 'checkout', '-q', 'main');

    commit(repo, 'two files\n\nReview-Thread: t-multi', {
      'f.txt': lines(10, 'f').replace('f2\n', 'f2 fixed\n'),
      'g.txt': lines(10, 'g') + 'g11\n',
    });
    commit(repo, 'no trailer', { 'f.txt': lines(10, 'f') });
    commit(repo, 'rename\n\nreview-thread: t-rename', {
      'old-name.txt': null,
      'new-name.txt': lines(20, 'moved').replace('moved20', 'moved twenty'),
    });
    commit(repo, 'binary and text\n\nReview-Thread: t-binary', {
      'bin.dat': Buffer.concat([binary, Buffer.from([9])]),
      'f.txt': 'f0\n' + lines(10, 'f'),
    });
    commit(repo, 'nothing changed\n\nReview-Thread: t-empty');
    commit(
      repo,
      [
        'diff --git a/f.txt b/f.txt',
        '',
        'diff --git a/fake.txt b/fake.txt',
        '--- a/fake.txt',
        '+++ b/fake.txt',
        '@@ -1 +1 @@',
        '-fake',
        '+fake',
        '',
        'Review-Thread: t-tricky',
        'Review-Thread: t-tricky-2',
      ].join('\n'),
      { 'g.txt': lines(10, 'g') },
    );
    const fakeHeader = `\u0000${target}\u0000${target}\u0000fake\u0000t-fake\u0000`;
    commit(repo, 'text holding the separator\n\nReview-Thread: t-nul', {
      'nul.raw': `plain\nx\r${fakeHeader}\ny\u2028${fakeHeader}\nz\u2029${fakeHeader}\ndiff --git a/nul.raw b/nul.raw\n`,
    });
    const merged = merge(repo, 'side', 'merge side\n\nReview-Thread: t-merge');
    git(repo, 'checkout', '-q', '-b', 'side-ours', target);
    commit(repo, 'dropped work', { 'side.txt': 'dropped\n' });
    git(repo, 'checkout', '-q', 'main');
    const oursMerge = merge(repo, 'side-ours', 'keep ours\n\nReview-Thread: t-ours', 'ours');

    const parser = new GitDiffParser(repo);
    const fixups = await parser.listThreadFixups({
      targetCommitish: target,
      baseCommitish: target,
    });

    expect(fixups.map((fixup) => [fixup.subject, fixup.threadIds])).toEqual([
      ['two files', ['t-multi']],
      ['rename', ['t-rename']],
      ['binary and text', ['t-binary']],
      ['nothing changed', ['t-empty']],
      ['diff --git a/f.txt b/f.txt', ['t-tricky', 't-tricky-2']],
      ['text holding the separator', ['t-nul']],
      ['merge side', ['t-merge']],
      ['keep ours', ['t-ours']],
    ]);
    for (const fixup of fixups) {
      expect(fixup.files, fixup.subject).toEqual(diffAgainstFirstParent(parser, repo, fixup.sha));
      expect(fixup.shortSha).toBe(fixup.sha.slice(0, 7));
    }

    const bySubject = new Map(fixups.map((fixup) => [fixup.subject, fixup]));
    expect(bySubject.get('two files')?.files.map((file) => file.path)).toEqual(['f.txt', 'g.txt']);
    expect(bySubject.get('rename')?.files[0]).toMatchObject({
      path: 'new-name.txt',
      oldPath: 'old-name.txt',
      status: 'renamed',
    });
    expect(bySubject.get('binary and text')?.files.map((file) => file.path)).toEqual([
      'bin.dat',
      'f.txt',
    ]);
    expect(bySubject.get('nothing changed')?.files).toEqual([]);
    expect(bySubject.get('nothing changed')?.patchId).toBe(bySubject.get('nothing changed')?.sha);
    expect(bySubject.get('diff --git a/f.txt b/f.txt')?.files.map((file) => file.path)).toEqual([
      'g.txt',
    ]);
    expect(
      bySubject
        .get('text holding the separator')
        ?.files[0].chunks.flatMap((chunk) => chunk.lines.map((line) => line.content)),
    ).toEqual(
      expect.arrayContaining([`x\r${fakeHeader}`, `y\u2028${fakeHeader}`, `z\u2029${fakeHeader}`]),
    );
    expect(bySubject.get('merge side')?.sha).toBe(merged);
    expect(bySubject.get('merge side')?.files.map((file) => file.path)).toEqual(['side.txt']);
    expect(bySubject.get('keep ours')?.sha).toBe(oursMerge);
    expect(bySubject.get('keep ours')?.files).toEqual([]);
  });

  it('spawns the same number of git processes however many fixups there are', async () => {
    const repo = createRepo();
    commit(repo, 'base', { 'f.txt': lines(40, 'f') });
    const target = git(repo, 'rev-parse', 'HEAD');
    let text = lines(40, 'f');
    const fixup = (index: number) => {
      text = text.replace(`f${index}\n`, `f${index} fixed\n`);
      return commit(repo, `fixup ${index}\n\nReview-Thread: t${index}`, { 'f.txt': text });
    };
    const mergedFixup = (index: number) => {
      git(repo, 'checkout', '-q', '-b', `side${index}`, target);
      commit(repo, `side ${index}`, { [`side${index}.txt`]: `${index}\n` });
      git(repo, 'checkout', '-q', 'main');
      merge(repo, `side${index}`, `merge ${index}\n\nReview-Thread: m${index}`);
    };
    const listAndCount = async () => {
      const parser = new GitDiffParser(repo);
      const calls = countGitCalls(parser);
      const fixups = await parser.listThreadFixups({
        targetCommitish: target,
        baseCommitish: target,
      });
      return { fixups, calls };
    };

    fixup(1);
    mergedFixup(1);
    const few = await listAndCount();

    for (let index = 2; index <= 12; index++) fixup(index);
    mergedFixup(2);
    mergedFixup(3);
    const many = await listAndCount();

    expect(few.fixups).toHaveLength(2);
    expect(many.fixups).toHaveLength(15);
    expect(many.calls).toEqual(few.calls);
    expect(many.calls.length).toBeLessThanOrEqual(4);
  });

  it('reads one fixup the same as the list does', async () => {
    const repo = createRepo();
    commit(repo, 'base', { 'f.txt': lines(5, 'f') });
    const target = git(repo, 'rev-parse', 'HEAD');
    commit(repo, 'first\n\nReview-Thread: t1', { 'f.txt': lines(5, 'f') + 'f6\n' });
    const second = commit(repo, 'second\n\nReview-Thread: t2', {
      'f.txt': lines(5, 'f').replace('f2\n', 'f2 fixed\n') + 'f6\n',
    });

    const parser = new GitDiffParser(repo);
    const listed = await parser.listThreadFixups({
      targetCommitish: target,
      baseCommitish: target,
    });

    expect(await parser.readThreadFixup(second)).toEqual(listed.find((f) => f.sha === second));
  });

  it('reads fixups that are not merges with a single git log', async () => {
    const repo = createRepo();
    commit(repo, 'base', { 'f.txt': 'a\n' });
    const target = git(repo, 'rev-parse', 'HEAD');
    for (let index = 1; index <= 5; index++) {
      commit(repo, `fixup ${index}\n\nReview-Thread: t${index}`, { 'f.txt': `a\n${index}\n` });
    }

    const parser = new GitDiffParser(repo);
    const calls = countGitCalls(parser);
    const fixups = await parser.listThreadFixups({
      targetCommitish: target,
      baseCommitish: target,
    });

    expect(fixups).toHaveLength(5);
    expect(calls).toEqual(['revparse', 'revparse', 'raw']);
  });
});

describe('findNewerTarget against a real repository', () => {
  it('stays quiet while only fixups follow the target', async () => {
    const repo = createRepo();
    const target = commit(repo, 'base', { 'f.txt': 'a\n' });
    commit(repo, `fixup! ${target}`, { 'f.txt': 'b\n' });
    commit(repo, 'squash! base', { 'f.txt': 'c\n' });
    commit(repo, 'amend! base', { 'f.txt': 'd\n' });
    commit(repo, 'answer\n\nreview-thread: t1', { 'f.txt': 'e\n' });

    const parser = new GitDiffParser(repo);

    expect(await parser.findNewerTarget(target, 'HEAD', target)).toBeNull();
  });

  it('counts commits autosquash would not fold, and reopens at the newest of them', async () => {
    const repo = createRepo();
    const target = commit(repo, 'base', { 'f.txt': 'a\n' });
    commit(repo, 'Fixup! capitalised', { 'g.txt': 'g\n' });
    commit(repo, 'Revert "fixup! x"', { 'g.txt': 'i\n' });
    const newest = commit(repo, 'next feature\n\nfixup! quoted in the body', { 'g.txt': 'h\n' });
    commit(repo, `fixup! ${target}`, { 'f.txt': 'b\n' });

    const parser = new GitDiffParser(repo);

    expect(await parser.findNewerTarget(target, 'refs/heads/main', target)).toEqual({
      ref: 'main',
      commit: newest,
      commitCount: 3,
    });
  });

  it('leaves out commits the ref already held at launch', async () => {
    const repo = createRepo();
    const older = commit(repo, 'older', { 'f.txt': 'a\n' });
    commit(repo, 'middle', { 'f.txt': 'b\n' });
    const launch = commit(repo, 'launch', { 'f.txt': 'c\n' });

    const parser = new GitDiffParser(repo);

    expect(await parser.findNewerTarget(older, 'HEAD', launch)).toBeNull();

    const later = commit(repo, 'later', { 'f.txt': 'd\n' });

    expect(await parser.findNewerTarget(older, 'HEAD', launch)).toEqual({
      ref: 'HEAD',
      commit: later,
      commitCount: 1,
    });
  });

  it('points at the folded history after the target is rewritten', async () => {
    const repo = createRepo();
    commit(repo, 'root', { 'f.txt': 'a\n' });
    const target = commit(repo, 'base', { 'f.txt': 'b\n' });
    commit(repo, `fixup! ${target}`, { 'f.txt': 'c\n' });
    git(repo, 'reset', '-q', '--soft', 'HEAD~2');
    const folded = commit(repo, 'base');

    const parser = new GitDiffParser(repo);

    expect(await parser.findNewerTarget(target, 'HEAD', target)).toEqual({
      ref: 'HEAD',
      commit: folded,
      commitCount: 1,
    });
  });

  it('stays quiet when the ref is gone or still on the target', async () => {
    const repo = createRepo();
    const target = commit(repo, 'base', { 'f.txt': 'a\n' });

    const parser = new GitDiffParser(repo);

    expect(await parser.findNewerTarget(target, 'HEAD', target)).toBeNull();
    expect(await parser.findNewerTarget(target, 'refs/heads/deleted', target)).toBeNull();
  });
});
