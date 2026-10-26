import { execFileSync, spawnSync } from 'child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  type ScipBuildState,
  ScipIndexBuilder,
  findScipJava,
  isIndexableCommit,
  scipIndexCacheRoot,
  toolSpawnSpec,
} from './scip-build';

const FIXTURE = join(__dirname, 'scip-index-fixture', 'index.scip');
const posixOnly = process.platform === 'win32' ? it.skip : it;

let home: string;
const savedEnv = { ...process.env };
const temps: string[] = [];
const builders: ScipIndexBuilder[] = [];

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'difit-scip-build-home-'));
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
  await Promise.all(builders.splice(0).map((builder) => builder.stop()));
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

function git(repo: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
}

function writeFiles(root: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

function commit(repo: string, files: Record<string, string>): string {
  writeFiles(repo, files);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'change');
  return git(repo, 'rev-parse', 'HEAD');
}

const JAVA_PROJECT = {
  'build.gradle': "plugins { id 'java' }\n",
  'src/main/java/demo/Port.java': 'package demo;\ninterface Port {}\n',
};

function createRepo(): string {
  const repo = tempDir('difit-scip-build-repo-');
  git(repo, 'init', '-q');
  git(repo, 'checkout', '-q', '-b', 'main');
  return repo;
}

// A stand-in for scip-java: `index --output <path>` runs `body` in the extracted tree,
// where $OUT is the output path and $LOG a file outside the cache for the test to read.
function fakeScipJava(body: string): { path: string; log: string } {
  const dir = tempDir('difit-fake-scip-java-');
  const path = join(dir, 'scip-java');
  const log = join(dir, 'calls.log');
  writeFileSync(
    path,
    `#!/bin/sh\nOUT="$3"\nLOG='${log}'\necho "run $1 $2 $(pwd)" >> "$LOG"\n${body}\n`,
  );
  chmodSync(path, 0o755);
  return { path, log };
}

const WRITES_INDEX = `[ -f build.gradle ] || exit 7\ncp '${FIXTURE}' "$OUT"`;

function calls(log: string): string[] {
  return existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [];
}

function newBuilder(repo: string, tool: string | undefined, cacheRoot: string, timeoutMs?: number) {
  const builder = new ScipIndexBuilder({
    repoPath: repo,
    cacheRoot,
    env: { DIFIT_SCIP_JAVA: tool, PATH: '' },
    timeoutMs,
  });
  builders.push(builder);
  const events: Array<[string, ScipBuildState['status']]> = [];
  builder.onChange((sha, state) => events.push([sha, state.status]));
  return { builder, events };
}

function isAlive(pid: number): boolean {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    // A zombie waiting for its parent to reap it is already dead.
    return !/^\d+ \(.*\) Z/.test(stat);
  } catch {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
}

async function waitFor(check: () => boolean, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('findScipJava', () => {
  posixOnly('prefers DIFIT_SCIP_JAVA, then looks on PATH', async () => {
    const configured = fakeScipJava('exit 0').path;
    const pathDir = tempDir('difit-scip-path-');
    const onPath = join(pathDir, 'scip-java');
    writeFileSync(onPath, '#!/bin/sh\n');
    chmodSync(onPath, 0o755);

    await expect(findScipJava({ DIFIT_SCIP_JAVA: configured, PATH: pathDir })).resolves.toBe(
      configured,
    );
    await expect(findScipJava({ PATH: `/nonexistent:${pathDir}` })).resolves.toBe(onPath);
    await expect(
      findScipJava({ DIFIT_SCIP_JAVA: join(pathDir, 'missing'), PATH: pathDir }),
    ).resolves.toBe(onPath);
  });

  posixOnly(
    'skips files that are not executable and returns null when nothing is found',
    async () => {
      const pathDir = tempDir('difit-scip-path-');
      writeFileSync(join(pathDir, 'scip-java'), 'not executable');
      await expect(findScipJava({ PATH: pathDir })).resolves.toBeNull();
      await expect(findScipJava({})).resolves.toBeNull();
    },
  );

  it('tries the PATHEXT extensions on Windows, with a case-insensitive Path variable', async () => {
    const pathDir = tempDir('difit-scip-path-');
    writeFileSync(join(pathDir, 'scip-java.cmd'), '@echo off\n');
    await expect(findScipJava({ Path: pathDir, PathExt: '.EXE;.CMD' }, 'win32')).resolves.toBe(
      join(pathDir, 'scip-java.cmd'),
    );
  });
});

describe('toolSpawnSpec', () => {
  it('runs .bat and .cmd tools through the shell on Windows, quoting each part', () => {
    expect(
      toolSpawnSpec(
        'C:\\Tools Dir\\scip-java.cmd',
        ['index', '--output', 'C:\\a b\\index.scip'],
        'win32',
      ),
    ).toEqual({
      command: '"C:\\Tools Dir\\scip-java.cmd" "index" "--output" "C:\\a b\\index.scip"',
      args: [],
      shell: true,
    });
    expect(toolSpawnSpec('C:\\Tools\\scip-java.exe', ['index'], 'win32')).toEqual({
      command: 'C:\\Tools\\scip-java.exe',
      args: ['index'],
      shell: false,
    });
    expect(toolSpawnSpec('/usr/bin/scip-java', ['index'], 'linux').shell).toBe(false);
  });
});

describe('scipIndexCacheRoot', () => {
  it('sits in the difit config directory', () => {
    const saved = process.env.DIFIT_CONFIG_DIR;
    process.env.DIFIT_CONFIG_DIR = '/tmp/difit-config';
    try {
      expect(scipIndexCacheRoot()).toBe(join('/tmp/difit-config', 'scip-index'));
    } finally {
      if (saved === undefined) delete process.env.DIFIT_CONFIG_DIR;
      else process.env.DIFIT_CONFIG_DIR = saved;
    }
  });
});

describe('isIndexableCommit', () => {
  it('needs Java sources and a build file at the root of the tree', async () => {
    const repo = createRepo();
    const docsOnly = commit(repo, { 'README.md': 'hi\n', 'build.gradle': '' });
    const nestedBuild = commit(repo, {
      'build.gradle': '',
      'sub/pom.xml': '<project/>\n',
      'sub/A.java': 'class A {}\n',
    });
    git(repo, 'rm', '-q', 'build.gradle');
    git(repo, 'commit', '-q', '-m', 'drop root build file');
    const noRootBuild = git(repo, 'rev-parse', 'HEAD');
    const maven = commit(repo, { 'pom.xml': '<project/>\n' });

    await expect(isIndexableCommit(repo, docsOnly)).resolves.toBe(false);
    await expect(isIndexableCommit(repo, nestedBuild)).resolves.toBe(true);
    await expect(isIndexableCommit(repo, noRootBuild)).resolves.toBe(false);
    await expect(isIndexableCommit(repo, maven)).resolves.toBe(true);
    await expect(isIndexableCommit(repo, '0'.repeat(40))).resolves.toBe(false);
  });
});

describe('ScipIndexBuilder', () => {
  it('builds nothing when scip-java is missing', async () => {
    const repo = createRepo();
    const sha = commit(repo, JAVA_PROJECT);
    const cache = tempDir('difit-scip-cache-');
    const { builder, events } = newBuilder(repo, undefined, cache);

    await expect(builder.request(sha)).resolves.toEqual({ status: 'none' });
    expect(builder.state(sha)).toEqual({ status: 'none' });
    expect(events).toEqual([]);
    expect(readdirSync(cache)).toEqual([]);
  });

  posixOnly('leaves commits without Java or a root build file alone', async () => {
    const repo = createRepo();
    const sha = commit(repo, { 'README.md': 'hi\n' });
    const fake = fakeScipJava(WRITES_INDEX);
    const { builder, events } = newBuilder(repo, fake.path, tempDir('difit-scip-cache-'));

    await expect(builder.request(sha)).resolves.toEqual({ status: 'none' });
    await expect(builder.request('HEAD')).resolves.toEqual({ status: 'none' });
    expect(events).toEqual([]);
    expect(calls(fake.log)).toEqual([]);
  });

  posixOnly('builds only for a full lowercase hash', async () => {
    const repo = createRepo();
    const sha = commit(repo, JAVA_PROJECT);
    const fake = fakeScipJava(WRITES_INDEX);
    const { builder, events } = newBuilder(repo, fake.path, tempDir('difit-scip-cache-'));

    for (const name of ['HEAD', 'main', sha.slice(0, 7), sha.toUpperCase(), `${sha}~0`]) {
      await expect(builder.request(name)).resolves.toEqual({ status: 'none' });
    }
    expect(events).toEqual([]);
    await expect(builder.request(sha)).resolves.toEqual({ status: 'ready' });
    expect(events).toEqual([
      [sha, 'building'],
      [sha, 'ready'],
    ]);
    expect(calls(fake.log)).toHaveLength(1);
  });

  posixOnly('builds a commit once and reuses the stored index in a later run', async () => {
    const repo = createRepo();
    const sha = commit(repo, JAVA_PROJECT);
    const cache = tempDir('difit-scip-cache-');
    const fake = fakeScipJava(WRITES_INDEX);
    const { builder, events } = newBuilder(repo, fake.path, cache);

    expect(builder.state(sha)).toEqual({ status: 'none' });
    await expect(builder.request(sha)).resolves.toEqual({ status: 'ready' });
    expect(events).toEqual([
      [sha, 'building'],
      [sha, 'ready'],
    ]);

    const [call] = calls(fake.log);
    expect(call).toMatch(new RegExp(`^run index --output ${join(cache, sha)}/work-`));
    // Only the stored lookup form stays: the extracted tree, raw index and log are gone.
    expect(readdirSync(join(cache, sha))).toEqual(['index.lookup.gz']);

    const index = await builder.getIndex(sha);
    expect(index?.hasDocument('src/main/java/demo/Service.java')).toBe(true);

    const later = newBuilder(repo, fake.path, cache);
    await expect(later.builder.request(sha)).resolves.toEqual({ status: 'ready' });
    const reloaded = await later.builder.getIndex(sha);
    expect(reloaded?.hasDocument('src/main/java/demo/Service.java')).toBe(true);
    expect(calls(fake.log)).toHaveLength(1);
  });

  posixOnly('shares one build between requests for the same commit', async () => {
    const repo = createRepo();
    const sha = commit(repo, JAVA_PROJECT);
    const fake = fakeScipJava(`sleep 0.3\n${WRITES_INDEX}`);
    const { builder, events } = newBuilder(repo, fake.path, tempDir('difit-scip-cache-'));

    const results = await Promise.all([builder.request(sha), builder.request(sha)]);
    await expect(builder.request(sha)).resolves.toEqual({ status: 'ready' });
    expect(results).toEqual([{ status: 'ready' }, { status: 'ready' }]);
    expect(calls(fake.log)).toHaveLength(1);
    expect(events.map(([, status]) => status)).toEqual(['building', 'ready']);
  });

  posixOnly('runs builds for different commits one after another', async () => {
    const repo = createRepo();
    const first = commit(repo, JAVA_PROJECT);
    const second = commit(repo, {
      'src/main/java/demo/Other.java': 'package demo;\nclass Other {}\n',
    });
    const fake = fakeScipJava(
      `echo start >> "$LOG"\nsleep 0.3\necho end >> "$LOG"\n${WRITES_INDEX}`,
    );
    const { builder } = newBuilder(repo, fake.path, tempDir('difit-scip-cache-'));

    const both = Promise.all([builder.request(first), builder.request(second)]);
    await waitFor(() => calls(fake.log).length > 0);
    // The second commit waits for the first and counts as building meanwhile.
    expect(builder.state(second)).toEqual({ status: 'building' });
    await expect(both).resolves.toEqual([{ status: 'ready' }, { status: 'ready' }]);
    expect(calls(fake.log).filter((line) => !line.startsWith('run'))).toEqual([
      'start',
      'end',
      'start',
      'end',
    ]);
  });

  posixOnly('reports a failed build and keeps the tail of its log', async () => {
    const repo = createRepo();
    const sha = commit(repo, JAVA_PROJECT);
    const cache = tempDir('difit-scip-cache-');
    const fake = fakeScipJava('echo "FAILURE: Build failed with an exception."\nexit 1');
    const { builder, events } = newBuilder(repo, fake.path, cache);

    const logPath = join(cache, sha, 'build.log');
    const failed = { status: 'failed', reason: 'scip-java exited with code 1', logPath };
    await expect(builder.request(sha)).resolves.toEqual(failed);
    expect(builder.state(sha)).toEqual(failed);
    expect(events.map(([, status]) => status)).toEqual(['building', 'failed']);
    expect(readFileSync(logPath, 'utf8')).toContain('FAILURE: Build failed with an exception.');
    expect(readdirSync(join(cache, sha))).toEqual(['build.log']);
    await expect(builder.getIndex(sha)).resolves.toBeNull();

    // A failure is not retried within the same run.
    await expect(builder.request(sha)).resolves.toEqual(failed);
    expect(calls(fake.log)).toHaveLength(1);
  });

  posixOnly('fails a build whose tool writes no index or runs past the time limit', async () => {
    const repo = createRepo();
    const sha = commit(repo, JAVA_PROJECT);
    const silent = newBuilder(repo, fakeScipJava('exit 0').path, tempDir('difit-scip-cache-'));
    await expect(silent.builder.request(sha)).resolves.toMatchObject({
      status: 'failed',
      reason: 'scip-java wrote no index.scip',
    });

    const slow = newBuilder(
      repo,
      fakeScipJava('echo compiling\nsleep 30').path,
      tempDir('difit-scip-cache-'),
      300,
    );
    const result = await slow.builder.request(sha);
    expect(result).toMatchObject({ status: 'failed', reason: 'scip-java timed out' });
    if (result.status !== 'failed' || !result.logPath) throw new Error('expected a log');
    expect(readFileSync(result.logPath, 'utf8')).toMatch(/compiling[\s\S]*scip-java timed out/);
  });

  posixOnly('fails instead of hanging when tar stops while git still has output', async () => {
    const repo = createRepo();
    // Far more than a pipe buffer, so git archive is still writing when tar exits.
    const sha = commit(repo, { ...JAVA_PROJECT, 'big.txt': 'x'.repeat(4 * 1024 * 1024) });
    const binDir = tempDir('difit-fake-tar-');
    writeFileSync(join(binDir, 'tar'), '#!/bin/sh\necho "tar: boom" >&2\nexit 2\n');
    chmodSync(join(binDir, 'tar'), 0o755);
    const savedPath = process.env.PATH;
    process.env.PATH = `${binDir}:${savedPath ?? ''}`;
    try {
      const fake = fakeScipJava(WRITES_INDEX);
      const cache = tempDir('difit-scip-cache-');
      const { builder } = newBuilder(repo, fake.path, cache);
      await expect(builder.request(sha)).resolves.toMatchObject({
        status: 'failed',
        reason: expect.stringMatching(/^tar exited with code 2: .*tar: boom/),
      });
      expect(calls(fake.log)).toEqual([]);
      expect(readdirSync(join(cache, sha))).toEqual(['build.log']);
    } finally {
      process.env.PATH = savedPath;
    }
  });

  posixOnly('removes a work tree the build left read-only', async () => {
    const repo = createRepo();
    const sha = commit(repo, JAVA_PROJECT);
    const cache = tempDir('difit-scip-cache-');
    const fake = fakeScipJava(
      `mkdir -p build/ro && touch build/ro/f && chmod 555 build/ro\n${WRITES_INDEX}`,
    );
    const { builder, events } = newBuilder(repo, fake.path, cache);

    await expect(builder.request(sha)).resolves.toEqual({ status: 'ready' });
    expect(events.map(([, status]) => status)).toEqual(['building', 'ready']);
    expect(readdirSync(join(cache, sha))).toEqual(['index.lookup.gz']);
  });

  posixOnly('removes work trees left by difit processes that are gone', async () => {
    const repo = createRepo();
    const sha = commit(repo, JAVA_PROJECT);
    const other = '1'.repeat(40);
    const cache = tempDir('difit-scip-cache-');
    const deadPid = spawnSync('true').pid;
    const stale = join(cache, other, `work-${deadPid}-abc`);
    // pid 1 is alive, so its directory may still be in use.
    const live = join(cache, other, 'work-1-abc');
    writeFiles(stale, { 'src/A.java': 'class A {}\n' });
    writeFiles(live, { 'src/A.java': 'class A {}\n' });
    const { builder } = newBuilder(repo, fakeScipJava(WRITES_INDEX).path, cache);

    await expect(builder.request(sha)).resolves.toEqual({ status: 'ready' });
    // The sweep runs beside the build; stop() waits for it.
    await builder.stop();
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(live)).toBe(true);
  });

  posixOnly('kills what the tool left running in its process group', async () => {
    const repo = createRepo();
    const sha = commit(repo, JAVA_PROJECT);
    const fake = fakeScipJava(
      `( exec sleep 60 ) > /dev/null 2>&1 &\necho "pids $!" >> "$LOG"\n${WRITES_INDEX}`,
    );
    const { builder } = newBuilder(repo, fake.path, tempDir('difit-scip-cache-'));

    await expect(builder.request(sha)).resolves.toEqual({ status: 'ready' });
    const pid = Number(
      (calls(fake.log).find((line) => line.startsWith('pids')) ?? '').split(' ')[1],
    );
    try {
      await waitFor(() => !isAlive(pid), 3000);
    } finally {
      if (isAlive(pid)) process.kill(pid, 'SIGKILL');
    }
  });

  posixOnly('rebuilds when the stored index is damaged', async () => {
    const repo = createRepo();
    const sha = commit(repo, JAVA_PROJECT);
    const cache = tempDir('difit-scip-cache-');
    const fake = fakeScipJava(WRITES_INDEX);
    const { builder, events } = newBuilder(repo, fake.path, cache);
    await builder.request(sha);

    const later = newBuilder(repo, fake.path, cache);
    await later.builder.request(sha);
    writeFileSync(join(cache, sha, 'index.lookup.gz'), 'garbage');
    await expect(later.builder.getIndex(sha)).resolves.toBeNull();
    expect(later.builder.state(sha)).toEqual({ status: 'none' });
    await expect(later.builder.request(sha)).resolves.toEqual({ status: 'ready' });
    expect(calls(fake.log)).toHaveLength(2);
    expect(events.map(([, status]) => status)).toEqual(['building', 'ready']);
  });

  posixOnly('keeps at most the configured number of indexes in memory', async () => {
    const repo = createRepo();
    const shas = [
      commit(repo, JAVA_PROJECT),
      commit(repo, { 'src/main/java/demo/B.java': 'package demo;\nclass B {}\n' }),
      commit(repo, { 'src/main/java/demo/C.java': 'package demo;\nclass C {}\n' }),
    ];
    const cache = tempDir('difit-scip-cache-');
    const fake = fakeScipJava(WRITES_INDEX);
    const builder = new ScipIndexBuilder({
      repoPath: repo,
      cacheRoot: cache,
      env: { DIFIT_SCIP_JAVA: fake.path },
      maxLoaded: 2,
    });
    builders.push(builder);
    for (const sha of shas) await builder.request(sha);

    const [first, second, third] = shas as [string, string, string];
    // Each build leaves its index loaded, so the last two are in memory now.
    const secondIndex = await builder.getIndex(second);
    const thirdIndex = await builder.getIndex(third);
    expect(await builder.getIndex(second)).toBe(secondIndex);
    expect(await builder.getIndex(first)).not.toBeNull();
    // Reading the first one pushed out the least recently used, the third.
    expect(await builder.getIndex(second)).toBe(secondIndex);
    expect(await builder.getIndex(third)).not.toBe(thirdIndex);
  });

  posixOnly('stop() kills the running tool with the processes it started', async () => {
    const repo = createRepo();
    const sha = commit(repo, JAVA_PROJECT);
    const cache = tempDir('difit-scip-cache-');
    // The grandchild ignores SIGTERM, as a busy JVM may, so only SIGKILL ends it.
    const fake = fakeScipJava(
      `sh -c 'trap "" TERM; while :; do sleep 1; done' &\necho "pids $$ $!" >> "$LOG"\nsleep 300`,
    );
    const { builder } = newBuilder(repo, fake.path, cache);

    const request = builder.request(sha);
    await waitFor(() => calls(fake.log).some((line) => line.startsWith('pids')));
    const pids = (calls(fake.log).find((line) => line.startsWith('pids')) ?? '')
      .split(' ')
      .slice(1)
      .map(Number);
    expect(pids.every(isAlive)).toBe(true);

    try {
      await builder.stop();
      await builder.stop();
      await expect(request).resolves.toEqual({ status: 'none' });
      await waitFor(() => !pids.some(isAlive), 3000);
      expect(readdirSync(join(cache, sha)).filter((name) => name.startsWith('work-'))).toEqual([]);
      await expect(builder.request(sha)).resolves.toEqual({ status: 'none' });
    } finally {
      for (const pid of pids.filter(isAlive)) process.kill(pid, 'SIGKILL');
    }
  });

  posixOnly('kills the running tool when difit exits without stopping it', async () => {
    const repo = createRepo();
    const sha = commit(repo, JAVA_PROJECT);
    const fake = fakeScipJava(
      `sh -c 'trap "" TERM; while :; do sleep 1; done' &\necho "pids $$ $!" >> "$LOG"\nsleep 300`,
    );
    const { builder } = newBuilder(repo, fake.path, tempDir('difit-scip-cache-'));
    const listening = () => [
      process.listenerCount('exit'),
      process.listenerCount('SIGTERM'),
      process.listenerCount('SIGHUP'),
    ];
    const before = listening();
    const exitListeners = process.listeners('exit');

    const request = builder.request(sha);
    await waitFor(() => calls(fake.log).some((line) => line.startsWith('pids')));
    const pids = (calls(fake.log).find((line) => line.startsWith('pids')) ?? '')
      .split(' ')
      .slice(1)
      .map(Number);

    try {
      expect(listening()).toEqual(before.map((count) => count + 1));
      const onExit = process
        .listeners('exit')
        .find((listener) => !exitListeners.includes(listener));
      // An 'exit' listener gets no later event-loop turn, so the kill must be sent before it
      // returns. The loop below never yields, and the grandchild ignores SIGTERM.
      onExit?.(0);
      const deadline = Date.now() + 1000;
      while (pids.some(isAlive) && Date.now() < deadline);
      expect(pids.some(isAlive)).toBe(false);

      await expect(request).resolves.toMatchObject({ status: 'failed' });
      expect(listening()).toEqual(before);
    } finally {
      for (const pid of pids.filter(isAlive)) process.kill(pid, 'SIGKILL');
    }
  });

  posixOnly('leaves the repository work tree, index, refs and worktrees as they were', async () => {
    const repo = createRepo();
    const sha = commit(repo, JAVA_PROJECT);
    git(repo, 'checkout', '-q', '-b', 'topic');
    commit(repo, { 'src/main/java/demo/Later.java': 'package demo;\nclass Later {}\n' });
    writeFiles(repo, { 'src/main/java/demo/Port.java': 'package demo;\ninterface Port { }\n' });
    git(repo, 'add', 'src/main/java/demo/Port.java');
    writeFiles(repo, { 'notes.txt': 'untracked\n', 'build.gradle': '// edited\n' });

    const snapshot = () => ({
      status: git(repo, 'status', '--porcelain=v2', '--branch', '--untracked-files=all'),
      refs: git(repo, 'for-each-ref', '--format=%(refname) %(objectname)'),
      worktrees: git(repo, 'worktree', 'list', '--porcelain'),
      index: readFileSync(join(repo, '.git', 'index')).toString('hex'),
      head: readFileSync(join(repo, '.git', 'HEAD'), 'utf8'),
      edited: readFileSync(join(repo, 'build.gradle'), 'utf8'),
    });
    const before = snapshot();
    const fake = fakeScipJava(`grep -q "id 'java'" build.gradle || exit 9\n${WRITES_INDEX}`);
    const { builder } = newBuilder(repo, fake.path, tempDir('difit-scip-cache-'));

    // The fake fails unless it sees the committed build.gradle, not the edited one.
    await expect(builder.request(sha)).resolves.toEqual({ status: 'ready' });
    expect(snapshot()).toEqual(before);
  });
});
