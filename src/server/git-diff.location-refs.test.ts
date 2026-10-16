import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDiffSelection } from '../utils/diffSelection';

import { GitDiffParser } from './git-diff';

let home: string;
const savedEnv = { ...process.env };
const repos: string[] = [];

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'difit-location-home-'));
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

function write(repo: string, files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    writeFileSync(join(repo, path), content);
  }
}

function commit(repo: string, message: string, files: Record<string, string> = {}): string {
  write(repo, files);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '--allow-empty', '-m', message);
  return git(repo, 'rev-parse', '--short=7', 'HEAD');
}

function createRepo(): { repo: string; base: string; target: string } {
  const repo = mkdtempSync(join(tmpdir(), 'difit-location-'));
  repos.push(repo);
  git(repo, 'init', '-q');
  git(repo, 'checkout', '-q', '-b', 'main');
  const base = commit(repo, 'base', { 'a.ts': 'a1\n', 'b.ts': 'b1\n' });
  const target = commit(repo, 'target', { 'a.ts': 'a2\n', 'b.ts': 'b2\n' });
  return { repo, base, target };
}

describe('GitDiffParser.readCommentLocationRefs', () => {
  it('lists no file for a commit review while the working tree still holds that commit', async () => {
    const { repo, base, target } = createRepo();

    const refs = await new GitDiffParser(repo).readCommentLocationRefs(
      createDiffSelection(`${target}^`, 'HEAD'),
    );

    expect(refs).toEqual({
      oldCommit: base,
      newCommit: target,
      pathsChangedOnDisk: [],
      renamedFrom: {},
    });
  });

  it('lists the files that commits after the target or edits on disk have changed', async () => {
    const { repo, base, target } = createRepo();
    commit(repo, 'fixup', { 'a.ts': 'a3\n' });
    write(repo, { 'with space.ts': 'new\n' });
    git(repo, 'add', 'with space.ts');
    commit(repo, 'add a file with a space');
    write(repo, { 'with space.ts': 'edited\n' });

    const refs = await new GitDiffParser(repo).readCommentLocationRefs(
      createDiffSelection(base, target),
    );

    expect(refs.newCommit).toBe(target);
    expect(refs.pathsChangedOnDisk.sort()).toEqual(['a.ts', 'with space.ts']);
  });

  it('maps a renamed file to the path it had in the base', async () => {
    const { repo, target } = createRepo();
    git(repo, 'mv', 'b.ts', 'c.ts');
    const renamed = commit(repo, 'rename');

    const refs = await new GitDiffParser(repo).readCommentLocationRefs(
      createDiffSelection(target, renamed),
    );

    expect(refs.renamedFrom).toEqual({ 'c.ts': 'b.ts' });
  });

  it('reads the base found by merge-base for the old side', async () => {
    const { repo, base, target } = createRepo();
    git(repo, 'checkout', '-q', '-b', 'side', base);
    commit(repo, 'side', { 'b.ts': 'side\n' });
    git(repo, 'checkout', '-q', 'main');

    const refs = await new GitDiffParser(repo).readCommentLocationRefs(
      createDiffSelection('side', target, 'merge-base'),
    );

    expect(refs.oldCommit).toBe(base);
  });

  it('has no new-side commit for the index, and lists files with edits left unstaged', async () => {
    const { repo, target } = createRepo();
    write(repo, { 'a.ts': 'staged\n', 'b.ts': 'staged\n' });
    git(repo, 'add', '-A');
    write(repo, { 'a.ts': 'unstaged\n' });

    const refs = await new GitDiffParser(repo).readCommentLocationRefs(
      createDiffSelection('HEAD', 'staged'),
    );

    expect(refs).toEqual({ oldCommit: target, pathsChangedOnDisk: ['a.ts'], renamedFrom: {} });
  });

  it('refuses a ref that git would read as an option', async () => {
    const { repo } = createRepo();

    await expect(
      new GitDiffParser(repo).readCommentLocationRefs(createDiffSelection('--output=x', '.')),
    ).rejects.toThrow('Invalid base commit-ish format');
  });

  it('lists nothing when the new side is the working tree itself', async () => {
    const { repo, target } = createRepo();
    write(repo, { 'a.ts': 'edited\n' });
    git(repo, 'add', 'a.ts');
    write(repo, { 'a.ts': 'edited again\n' });
    const parser = new GitDiffParser(repo);

    expect(await parser.readCommentLocationRefs(createDiffSelection('HEAD', '.'))).toEqual({
      oldCommit: target,
      pathsChangedOnDisk: [],
      renamedFrom: {},
    });
    expect(await parser.readCommentLocationRefs(createDiffSelection('staged', 'working'))).toEqual({
      pathsChangedOnDisk: [],
      renamedFrom: {},
    });
  });
});
