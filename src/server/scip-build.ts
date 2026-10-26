import { type ChildProcess, spawn, spawnSync } from 'child_process';
import {
  access,
  chmod,
  constants,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'fs/promises';
import { join, resolve } from 'path';

import { runGit } from './run-git.js';
import { type ScipIndex, convertScipIndex, readScipIndex, writeScipIndex } from './scip-index.js';
import { getDifitConfigDir } from './user-config.js';

// Builds a SCIP index of one commit with scip-java, outside the repository: the commit's
// tree is extracted with `git archive` into the cache, so the work tree, index, refs and
// worktree list are never touched.

export type ScipBuildState =
  | { status: 'none' }
  | { status: 'building' }
  | { status: 'ready' }
  | { status: 'failed'; reason: string; logPath: string | null };

interface ScipIndexBuilderOptions {
  repoPath: string;
  // Where scip-java is looked up; defaults to process.env.
  env?: NodeJS.ProcessEnv;
  // Defaults to <DIFIT_CONFIG_DIR or ~/.difit>/scip-index.
  cacheRoot?: string;
  timeoutMs?: number;
  // Compact indexes kept in memory for lookups.
  maxLoaded?: number;
}

const COMPACT_FILE = 'index.lookup.gz';
const LOG_FILE = 'build.log';
const LOG_TAIL_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 60 * 60 * 1000;
const DEFAULT_MAX_LOADED = 2;
const KILL_GRACE_MS = 2000;
// Signals that end difit without its 'exit' event; children in their own process group
// never receive them.
const ENDING_SIGNALS = ['SIGTERM', 'SIGHUP'] as const;
const FULL_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const WORK_DIR = /^work-(\d+)-/;
const ROOT_BUILD_FILES = new Set([
  'build.gradle',
  'build.gradle.kts',
  'settings.gradle',
  'settings.gradle.kts',
  'pom.xml',
]);

export function scipIndexCacheRoot(): string {
  return join(getDifitConfigDir(), 'scip-index');
}

async function isExecutableFile(path: string, platform: NodeJS.Platform): Promise<boolean> {
  try {
    if (!(await stat(path)).isFile()) return false;
    if (platform !== 'win32') await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function envValue(env: NodeJS.ProcessEnv, name: string, platform: NodeJS.Platform): string {
  if (platform !== 'win32') return env[name] ?? '';
  const key = Object.keys(env).find((candidate) => candidate.toUpperCase() === name);
  return key ? (env[key] ?? '') : '';
}

// DIFIT_SCIP_JAVA (a path to the executable) first, then PATH.
export async function findScipJava(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<string | null> {
  const configured = env.DIFIT_SCIP_JAVA?.trim();
  if (configured && (await isExecutableFile(configured, platform))) return resolve(configured);

  const names =
    platform === 'win32'
      ? (envValue(env, 'PATHEXT', platform) || '.COM;.EXE;.BAT;.CMD')
          .split(';')
          .filter(Boolean)
          .map((ext) => `scip-java${ext.toLowerCase()}`)
      : ['scip-java'];
  const dirs = envValue(env, 'PATH', platform).split(platform === 'win32' ? ';' : ':');
  for (const dir of dirs) {
    if (!dir) continue;
    for (const name of names) {
      const candidate = join(dir, name);
      if (await isExecutableFile(candidate, platform)) return candidate;
    }
  }
  return null;
}

export async function isIndexableCommit(repoPath: string, sha: string): Promise<boolean> {
  const listing = await runGit(repoPath, ['ls-tree', '-r', '--name-only', '-z', sha]);
  if (listing.code !== 0) return false;
  let hasJava = false;
  let hasBuildFile = false;
  for (const path of listing.stdout.toString('utf8').split('\0')) {
    if (path.endsWith('.java')) hasJava = true;
    else if (ROOT_BUILD_FILES.has(path)) hasBuildFile = true;
    if (hasJava && hasBuildFile) return true;
  }
  return false;
}

interface SpawnSpec {
  command: string;
  args: string[];
  shell: boolean;
}

// Node refuses to spawn .bat/.cmd files without a shell on Windows.
export function toolSpawnSpec(tool: string, args: string[], platform: NodeJS.Platform): SpawnSpec {
  if (platform === 'win32' && /\.(?:bat|cmd)$/i.test(tool)) {
    return { command: [tool, ...args].map((part) => `"${part}"`).join(' '), args: [], shell: true };
  }
  return { command: tool, args, shell: false };
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (hasExited(child)) return Promise.resolve();
  return new Promise((resolvePromise) => {
    const timer = setTimeout(resolvePromise, timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolvePromise();
    });
  });
}

// Children are spawned in their own process group on POSIX, so the whole group goes,
// including Gradle and the compiler JVMs scip-java starts.
async function killProcessTree(child: ChildProcess, platform: NodeJS.Platform): Promise<void> {
  const pid = child.pid;
  if (pid === undefined) return;
  if (platform === 'win32') {
    if (hasExited(child)) return;
    await new Promise<void>((resolvePromise) => {
      const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.once('error', () => resolvePromise());
      killer.once('close', () => resolvePromise());
    });
    return;
  }
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    return;
  }
  await waitForExit(child, KILL_GRACE_MS);
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    // The group is already gone.
  }
}

function killProcessTreeNow(child: ChildProcess, platform: NodeJS.Platform): void {
  const pid = child.pid;
  if (pid === undefined) return;
  if (platform === 'win32') {
    if (!hasExited(child)) {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    }
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    // The group is already gone.
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

// The failed `rm` before this may still be removing entries, so missing ones are skipped.
async function makeWritable(dir: string): Promise<void> {
  try {
    await chmod(dir, 0o700);
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) await makeWritable(join(dir, entry.name));
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

// Build outputs may include read-only directories, which `rm` alone cannot empty on POSIX.
// A tree that still cannot be removed is left for the sweep of a later run.
async function removeTree(dir: string): Promise<void> {
  try {
    await rm(dir, { recursive: true, force: true, maxRetries: 3 });
    return;
  } catch {
    // Retried below once the tree is writable.
  }
  try {
    await makeWritable(dir);
    await rm(dir, { recursive: true, force: true, maxRetries: 3 });
  } catch {}
}

class BuildError extends Error {}

export class ScipIndexBuilder {
  private readonly repoPath: string;
  private readonly cacheRoot: string;
  private readonly timeoutMs: number;
  private readonly maxLoaded: number;
  private readonly platform: NodeJS.Platform;
  private readonly env: NodeJS.ProcessEnv;
  private readonly states = new Map<string, ScipBuildState>();
  private readonly jobs = new Map<string, Promise<ScipBuildState>>();
  private readonly loaded = new Map<string, ScipIndex>();
  private readonly loading = new Map<string, Promise<ScipIndex | null>>();
  private readonly listeners = new Set<(sha: string, state: ScipBuildState) => void>();
  private readonly children = new Set<ChildProcess>();
  private readonly abort = new AbortController();
  private tool: Promise<string | null> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private stopping: Promise<void> | null = null;
  private sweep: Promise<void> | null = null;
  private hooked = false;
  private readonly killOnExit = () => {
    for (const child of this.children) killProcessTreeNow(child, this.platform);
  };
  private readonly killOnSignal = (signal: NodeJS.Signals) => {
    this.killOnExit();
    this.unhookProcess();
    if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
  };

  constructor(options: ScipIndexBuilderOptions) {
    this.repoPath = options.repoPath;
    this.cacheRoot = options.cacheRoot ?? scipIndexCacheRoot();
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxLoaded = options.maxLoaded ?? DEFAULT_MAX_LOADED;
    this.platform = process.platform;
    this.env = options.env ?? process.env;
  }

  state(sha: string): ScipBuildState {
    return this.states.get(sha) ?? { status: 'none' };
  }

  onChange(listener: (sha: string, state: ScipBuildState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // Starts indexing a full commit sha unless it is already indexed, and settles with the
  // final state. Requests for the same commit share one build; builds run one at a time.
  request(sha: string): Promise<ScipBuildState> {
    const existing = this.jobs.get(sha);
    if (existing) return existing;
    const job = this.run(sha);
    this.jobs.set(sha, job);
    return job;
  }

  // The commit's index once it is ready, or null.
  async getIndex(sha: string): Promise<ScipIndex | null> {
    const cached = this.loaded.get(sha);
    if (cached) {
      this.remember(sha, cached);
      return cached;
    }
    if (this.state(sha).status !== 'ready') return null;
    let load = this.loading.get(sha);
    if (!load) {
      load = readScipIndex(this.compactPath(sha)).finally(() => this.loading.delete(sha));
      this.loading.set(sha, load);
    }
    const index = await load;
    if (index) {
      this.remember(sha, index);
    } else if (this.state(sha).status === 'ready') {
      // Removed or damaged on disk; a later request builds it again.
      await rm(this.compactPath(sha), { force: true });
      this.jobs.delete(sha);
      this.setState(sha, { status: 'none' });
    }
    return index;
  }

  stop(): Promise<void> {
    this.stopping ??= (async () => {
      this.abort.abort();
      await Promise.all([...this.children].map((child) => killProcessTree(child, this.platform)));
      await Promise.all([this.queue, this.sweep]);
      this.unhookProcess();
    })();
    return this.stopping;
  }

  private hookProcess(): void {
    if (this.hooked) return;
    this.hooked = true;
    process.on('exit', this.killOnExit);
    for (const signal of ENDING_SIGNALS) process.on(signal, this.killOnSignal);
  }

  private unhookProcess(): void {
    if (!this.hooked) return;
    this.hooked = false;
    process.off('exit', this.killOnExit);
    for (const signal of ENDING_SIGNALS) process.off(signal, this.killOnSignal);
  }

  private compactPath(sha: string): string {
    return join(this.cacheRoot, sha, COMPACT_FILE);
  }

  private setState(sha: string, state: ScipBuildState): void {
    this.states.set(sha, state);
    for (const listener of this.listeners) listener(sha, state);
  }

  private remember(sha: string, index: ScipIndex): void {
    this.loaded.delete(sha);
    this.loaded.set(sha, index);
    for (const oldest of this.loaded.keys()) {
      if (this.loaded.size <= this.maxLoaded) break;
      this.loaded.delete(oldest);
    }
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  private async run(sha: string): Promise<ScipBuildState> {
    try {
      return await this.prepareAndBuild(sha);
    } catch (error) {
      const reason = `index build failed: ${error instanceof Error ? error.message : String(error)}`;
      const state: ScipBuildState = this.abort.signal.aborted
        ? { status: 'none' }
        : { status: 'failed', reason, logPath: null };
      this.setState(sha, state);
      return state;
    }
  }

  private async prepareAndBuild(sha: string): Promise<ScipBuildState> {
    if (!FULL_SHA.test(sha) || this.abort.signal.aborted) return { status: 'none' };
    this.sweep ??= this.sweepStaleWork();
    if (await this.exists(this.compactPath(sha))) {
      this.setState(sha, { status: 'ready' });
      return this.state(sha);
    }
    this.tool ??= findScipJava(this.env, this.platform);
    const tool = await this.tool;
    if (!tool || !(await isIndexableCommit(this.repoPath, sha)) || this.abort.signal.aborted) {
      return { status: 'none' };
    }

    this.setState(sha, { status: 'building' });
    const build = this.queue.then(() => this.build(sha, tool));
    this.queue = build.catch(() => undefined);
    const result = await build;
    this.setState(sha, result);
    return result;
  }

  private async build(sha: string, tool: string): Promise<ScipBuildState> {
    const dir = join(this.cacheRoot, sha);
    const compactPath = this.compactPath(sha);
    const logPath = join(dir, LOG_FILE);
    // Another difit process may have finished this commit while this one waited.
    if (await this.exists(compactPath)) return { status: 'ready' };
    if (this.abort.signal.aborted) return { status: 'none' };

    let work: string | null = null;
    try {
      await mkdir(dir, { recursive: true });
      work = await mkdtemp(join(dir, `work-${process.pid}-`));
      await this.extract(sha, work);
      await this.endChildren();
      const rawPath = join(work, 'index.scip');
      await this.index(tool, work, rawPath, logPath);
      await this.endChildren();
      if (!(await this.exists(rawPath))) throw new BuildError('scip-java wrote no index.scip');
      const index = await convertScipIndex(rawPath, { signal: this.abort.signal });
      await writeScipIndex(index, compactPath);
      this.remember(sha, index);
      await rm(logPath, { force: true });
      return { status: 'ready' };
    } catch (error) {
      if (this.abort.signal.aborted) return { status: 'none' };
      const reason =
        error instanceof BuildError
          ? error.message
          : `index build failed: ${error instanceof Error ? error.message : String(error)}`;
      return { status: 'failed', reason, logPath: await this.keepLogTail(logPath, reason) };
    } finally {
      await this.endChildren();
      if (work) await removeTree(work);
    }
  }

  // Work directories of difit processes that ended without cleaning up after themselves.
  private async sweepStaleWork(): Promise<void> {
    let commits: string[];
    try {
      commits = await readdir(this.cacheRoot);
    } catch {
      return;
    }
    for (const commit of commits) {
      let entries: string[];
      try {
        entries = await readdir(join(this.cacheRoot, commit));
      } catch {
        continue;
      }
      for (const name of entries) {
        const pid = Number(WORK_DIR.exec(name)?.[1] ?? NaN);
        if (Number.isNaN(pid) || pid === process.pid || isProcessAlive(pid)) continue;
        await removeTree(join(this.cacheRoot, commit, name));
      }
    }
  }

  private track(child: ChildProcess): void {
    this.children.add(child);
    this.hookProcess();
    // stop() may have run between the check before spawning and this call.
    if (this.abort.signal.aborted) void killProcessTree(child, this.platform);
  }

  private async endChildren(): Promise<void> {
    const children = [...this.children];
    await Promise.all(children.map((child) => killProcessTree(child, this.platform)));
    for (const child of children) this.children.delete(child);
    if (this.children.size === 0) this.unhookProcess();
  }

  private extract(sha: string, work: string): Promise<void> {
    return new Promise((resolvePromise, reject) => {
      const detached = this.platform !== 'win32';
      const git = spawn('git', ['archive', '--format=tar', sha], {
        cwd: this.repoPath,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached,
        windowsHide: true,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      });
      const tar = spawn('tar', ['-x', '-f', '-', '-C', work], {
        stdio: ['pipe', 'ignore', 'pipe'],
        detached,
        windowsHide: true,
      });
      this.track(git);
      this.track(tar);
      const errors: string[] = [];
      const collect = (chunk: Buffer) => {
        if (errors.join('').length < 4096) errors.push(chunk.toString('utf8'));
      };
      git.stderr.on('data', collect);
      tar.stderr.on('data', collect);
      tar.stdin.on('error', () => {});
      git.stdout.pipe(tar.stdin);

      let pending = 2;
      let failure: string | null = null;
      const settle = (name: string, code: number | null, error?: Error) => {
        const failed = failure !== null;
        if (error) failure ??= `${name} could not start: ${error.message}`;
        else if (code !== 0) failure ??= `${name} exited with code ${code}`;
        // Once tar is gone nothing reads git's output, so git would block on its next write.
        if (!failed && failure && pending > 1) {
          for (const child of [git, tar]) void killProcessTree(child, this.platform);
        }
        if (--pending > 0) return;
        if (failure) {
          const detail = errors.join('').trim().split('\n').slice(-3).join(' ');
          reject(new BuildError(detail ? `${failure}: ${detail}` : failure));
        } else {
          resolvePromise();
        }
      };
      for (const [name, child] of [
        ['git archive', git],
        ['tar', tar],
      ] as const) {
        let done = false;
        child.once('error', (error) => {
          if (done) return;
          done = true;
          settle(name, null, error);
        });
        child.once('close', (code) => {
          if (done) return;
          done = true;
          settle(name, code);
        });
      }
    });
  }

  private async index(tool: string, work: string, rawPath: string, logPath: string): Promise<void> {
    if (this.abort.signal.aborted) throw new BuildError('stopped');
    const log = await open(logPath, 'w');
    try {
      const spec = toolSpawnSpec(tool, ['index', '--output', rawPath], this.platform);
      const outcome = await new Promise<{ code: number | null; error?: Error; timedOut: boolean }>(
        (resolvePromise) => {
          const child = spawn(spec.command, spec.args, {
            cwd: work,
            stdio: ['ignore', log.fd, log.fd],
            shell: spec.shell,
            detached: this.platform !== 'win32',
            windowsHide: true,
          });
          this.track(child);
          let timedOut = false;
          const timer = setTimeout(() => {
            timedOut = true;
            void killProcessTree(child, this.platform);
          }, this.timeoutMs);
          child.once('error', (error) => {
            clearTimeout(timer);
            resolvePromise({ code: null, error, timedOut });
          });
          child.once('close', (code) => {
            clearTimeout(timer);
            resolvePromise({ code, timedOut });
          });
        },
      );
      if (outcome.error)
        throw new BuildError(`scip-java could not start: ${outcome.error.message}`);
      if (outcome.timedOut) throw new BuildError('scip-java timed out');
      if (outcome.code !== 0) {
        throw new BuildError(`scip-java exited with code ${outcome.code ?? 'null'}`);
      }
    } finally {
      await log.close();
    }
  }

  private async keepLogTail(logPath: string, reason: string): Promise<string | null> {
    try {
      let log: Buffer = Buffer.alloc(0);
      try {
        log = await readFile(logPath);
      } catch {
        // No log when the build failed before scip-java started.
      }
      const tail = log.subarray(Math.max(0, log.length - LOG_TAIL_BYTES));
      await writeFile(logPath, Buffer.concat([tail, Buffer.from(`\n[difit] ${reason}\n`)]));
      return logPath;
    } catch {
      return null;
    }
  }
}
