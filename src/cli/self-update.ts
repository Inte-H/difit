import { spawn } from 'node:child_process';
import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Command, Option } from 'commander';

import pkg from '../../package.json' with { type: 'json' };
import { getDifitConfigDir } from '../server/user-config.js';

import {
  INSTALL_MARKER,
  compareForkReleaseVersions,
  getVersionEntry,
  getVersionsDir,
  isCompleteVersion,
  listInstalledVersions,
  parseForkReleaseVersion,
} from './versions.js';

const DISABLE_AUTOUPDATE_ENV = 'DIFIT_DISABLE_AUTOUPDATE';
const RELEASE_BASE_URL_ENV = 'DIFIT_UPDATE_BASE_URL';
const DEFAULT_RELEASE_BASE_URL = 'https://github.com/duru-app/difit';

export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const LATEST_LOOKUP_TIMEOUT_MS = 10_000;
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
const UPDATE_RUN_LIMIT_MS = INSTALL_TIMEOUT_MS + 5 * 60 * 1000;
const KEEP_NEWEST_VERSIONS = 2;
const STAGING_PREFIX = '.staging-';

interface CheckState {
  checkedAt?: number;
  latestVersion?: string;
  result?: string;
}

export type RunInstall = (tarballUrl: string, prefix: string) => Promise<void>;

export interface UpdatePaths {
  configDir: string;
  versionsDir: string;
}

function defaultPaths(): UpdatePaths {
  const configDir = getDifitConfigDir();
  return { configDir, versionsDir: getVersionsDir(configDir) };
}

function checkStatePath(configDir: string): string {
  return join(configDir, 'update-check.json');
}

function runningDir(configDir: string): string {
  return join(configDir, 'running');
}

function getReleaseBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env[RELEASE_BASE_URL_ENV]?.trim() || DEFAULT_RELEASE_BASE_URL).replace(/\/+$/, '');
}

function getReleaseTarballUrl(baseUrl: string, version: string): string {
  return `${baseUrl}/releases/download/v${version}/difit-${version}.tgz`;
}

function isAutoUpdateEnabled(selfVersion: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (env[DISABLE_AUTOUPDATE_ENV] === '1' || env.NODE_ENV === 'development') return false;
  return parseForkReleaseVersion(selfVersion) !== null;
}

export function readCheckState(configDir: string): CheckState {
  try {
    const parsed: unknown = JSON.parse(readFileSync(checkStatePath(configDir), 'utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as CheckState) : {};
  } catch {
    return {};
  }
}

function writeFileAtomically(path: string, content: string): void {
  const temp = `${path}.tmp`;
  try {
    writeFileSync(temp, content);
    renameSync(temp, path);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

function writeCheckState(configDir: string, state: CheckState): void {
  mkdirSync(configDir, { recursive: true });
  writeFileAtomically(checkStatePath(configDir), `${JSON.stringify(state, null, 2)}\n`);
}

export function isCheckDue(state: CheckState, now: number): boolean {
  const { checkedAt } = state;
  if (typeof checkedAt !== 'number' || checkedAt > now) return true;
  return now - checkedAt >= CHECK_INTERVAL_MS;
}

const ownEntry = (): string => fileURLToPath(new URL('./index.js', import.meta.url));

// Detached so the launch never waits for the network or npm.
export function scheduleBackgroundUpdate(
  options: {
    selfVersion?: string;
    env?: NodeJS.ProcessEnv;
    now?: number;
    paths?: UpdatePaths;
    entry?: string;
    spawnProcess?: typeof spawn;
  } = {},
): boolean {
  const {
    selfVersion = pkg.version,
    env = process.env,
    now = Date.now(),
    paths = defaultPaths(),
    spawnProcess = spawn,
  } = options;
  try {
    if (!isAutoUpdateEnabled(selfVersion, env)) return false;
    if (!isCheckDue(readCheckState(paths.configDir), now)) return false;
    if (inspectLock(lockPathOf(paths.versionsDir)) === 'held') return false;
    const child = spawnProcess(
      process.execPath,
      [options.entry ?? ownEntry(), 'update', '--scheduled'],
      {
        detached: true,
        stdio: 'ignore',
        env: { ...env, DIFIT_CONFIG_DIR: resolve(paths.configDir) },
        cwd: homedir(),
        windowsHide: true,
      },
    );
    child.on('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

export async function fetchLatestReleaseVersion(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = LATEST_LOOKUP_TIMEOUT_MS,
): Promise<string> {
  // The redirect of /releases/latest names the tag without using the
  // rate-limited REST API.
  const response = await fetchImpl(`${baseUrl}/releases/latest`, {
    method: 'HEAD',
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const location = response.headers.get('location');
  if (response.status < 300 || response.status >= 400 || !location) {
    throw new Error(`Unexpected response from ${baseUrl}/releases/latest: ${response.status}`);
  }
  const tagPath = new URL(location, `${baseUrl}/`).pathname;
  const match = /\/releases\/tag\/v([^/]+)$/.exec(tagPath);
  const version = match?.[1] ? decodeURIComponent(match[1]) : '';
  if (!parseForkReleaseVersion(version)) {
    throw new Error(`Latest release is not a fork release: ${location}`);
  }
  return version;
}

function findBundledNpmCli(): string | null {
  const nodeDir = dirname(process.execPath);
  for (const candidate of [
    join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function npmInstall(tarballUrl: string, prefix: string): Promise<void> {
  const args = [
    'install',
    '--prefix',
    prefix,
    '--no-save',
    '--no-package-lock',
    '--no-audit',
    '--no-fund',
    '--loglevel=error',
    tarballUrl,
  ];
  const npmCli = findBundledNpmCli();
  const isWindows = process.platform === 'win32';
  const [command, commandArgs, shell]: [string, string[], boolean] = npmCli
    ? [process.execPath, [npmCli, ...args], false]
    : isWindows
      ? ['npm.cmd', args.map((arg) => `"${arg}"`), true]
      : ['npm', args, false];
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, commandArgs, {
      stdio: ['ignore', 'ignore', 'pipe'],
      shell,
      windowsHide: true,
    });
    let stderr = '';
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-4000);
    });
    let settled = false;
    let timedOut = false;
    const timers: NodeJS.Timeout[] = [];
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      timers.forEach(clearTimeout);
      child.stderr?.destroy();
      if (error) reject(error);
      else resolvePromise();
    };
    timers.push(
      setTimeout(() => {
        timedOut = true;
        child.kill();
        timers.push(setTimeout(() => child.kill('SIGKILL'), 10_000));
      }, INSTALL_TIMEOUT_MS),
    );
    child.once('error', finish);
    child.once('exit', (code, signal) => {
      const settle = () => {
        if (code === 0 && !timedOut) return finish();
        const reason = timedOut
          ? `did not finish in ${INSTALL_TIMEOUT_MS / 60_000} minutes`
          : `failed (${signal ?? code})`;
        finish(new Error(`npm install ${reason}: ${stderr.trim()}`));
      };
      // Waits for the rest of stderr, unless a process npm started still holds it.
      child.once('close', settle);
      timers.push(setTimeout(settle, 2000));
    });
  });
}

function readInstalledPackageVersion(versionDir: string): string | null {
  try {
    const manifest: unknown = JSON.parse(
      readFileSync(join(versionDir, 'node_modules', 'difit', 'package.json'), 'utf8'),
    );
    const version = (manifest as { version?: unknown }).version;
    return typeof version === 'string' ? version : null;
  } catch {
    return null;
  }
}

export async function installReleaseVersion(options: {
  version: string;
  baseUrl: string;
  versionsDir: string;
  runInstall?: RunInstall;
}): Promise<string> {
  const { version, baseUrl, versionsDir, runInstall = npmInstall } = options;
  const finalDir = join(versionsDir, version);
  const stagingDir = join(versionsDir, `${STAGING_PREFIX}${version}-${process.pid}`);
  mkdirSync(versionsDir, { recursive: true });
  rmSync(stagingDir, { recursive: true, force: true });
  mkdirSync(stagingDir, { recursive: true });
  try {
    await runInstall(getReleaseTarballUrl(baseUrl, version), stagingDir);
    const installed = readInstalledPackageVersion(stagingDir);
    if (installed !== version) {
      throw new Error(`Installed package reports version ${installed ?? 'unknown'}`);
    }
    const packageRoot = join(stagingDir, 'node_modules', 'difit');
    for (const required of [
      getVersionEntry(stagingDir),
      join(packageRoot, 'dist/client/index.html'),
    ]) {
      if (!existsSync(required)) {
        throw new Error(`Installed package is missing ${relative(stagingDir, required)}`);
      }
    }
    writeFileSync(
      join(stagingDir, INSTALL_MARKER),
      `${JSON.stringify({ version, installedAt: new Date().toISOString() })}\n`,
    );
    try {
      renameSync(stagingDir, finalDir);
    } catch {
      if (isCompleteVersion(finalDir)) {
        rmSync(stagingDir, { recursive: true, force: true });
        return finalDir;
      }
      rmSync(finalDir, { recursive: true, force: true });
      renameSync(stagingDir, finalDir);
    }
    return finalDir;
  } catch (error) {
    rmSync(stagingDir, { recursive: true, force: true });
    throw error;
  }
}

function removeQuietly(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {}
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function versionFolderOf(packageRoot: string, versionsDir: string): string | null {
  const rel = relative(resolve(versionsDir), resolve(packageRoot));
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
  return rel.split(sep)[0] ?? null;
}

// Each difit started from a versions folder leaves <pid>.json here so cleanup
// keeps the folder it serves files from.
export function registerRunningProcess(
  options: { configDir?: string; packageRoot?: string; pid?: number } = {},
): void {
  const {
    configDir = getDifitConfigDir(),
    packageRoot = fileURLToPath(new URL('../..', import.meta.url)),
    pid = process.pid,
  } = options;
  try {
    const realRoot = realpathSync(packageRoot);
    let versionsDir = getVersionsDir(configDir);
    if (existsSync(versionsDir)) versionsDir = realpathSync(versionsDir);
    if (!versionFolderOf(realRoot, versionsDir)) return;
    const dir = runningDir(configDir);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${pid}.json`);
    writeFileAtomically(file, `${JSON.stringify({ pid, packageRoot: realRoot })}\n`);
    process.once('exit', () => {
      try {
        unlinkSync(file);
      } catch {}
    });
  } catch {}
}

export function readVersionsInUse(configDir: string, versionsDir: string): Set<string> {
  const inUse = new Set<string>();
  const dir = runningDir(configDir);
  let realVersionsDir = versionsDir;
  try {
    realVersionsDir = realpathSync(versionsDir);
  } catch {}
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return inUse;
  }
  for (const file of files) {
    const path = join(dir, file);
    const leftover = /^(\d+)\.json\.tmp$/.exec(file);
    if (leftover) {
      if (!isProcessAlive(Number(leftover[1]))) removeQuietly(path);
      continue;
    }
    if (!file.endsWith('.json')) continue;
    try {
      const entry = JSON.parse(readFileSync(path, 'utf8')) as {
        pid?: unknown;
        packageRoot?: unknown;
      };
      if (typeof entry.pid !== 'number' || typeof entry.packageRoot !== 'string') {
        throw new Error('malformed');
      }
      if (!isProcessAlive(entry.pid)) {
        removeQuietly(path);
        continue;
      }
      const folder = versionFolderOf(entry.packageRoot, realVersionsDir);
      if (folder) inUse.add(folder);
    } catch {
      removeQuietly(path);
    }
  }
  return inUse;
}

export function cleanupVersions(versionsDir: string, inUse: Set<string>): string[] {
  let names: string[];
  try {
    names = readdirSync(versionsDir);
  } catch {
    return [];
  }
  const keep = new Set([
    ...listInstalledVersions(versionsDir).slice(0, KEEP_NEWEST_VERSIONS),
    ...inUse,
  ]);
  const removed: string[] = [];
  for (const name of names) {
    const isStaging = name.startsWith(STAGING_PREFIX);
    if (isStaging) {
      const owner = Number(/-(\d+)$/.exec(name)?.[1]);
      if (owner !== process.pid && isProcessAlive(owner)) continue;
    } else if (!parseForkReleaseVersion(name) || keep.has(name)) {
      continue;
    }
    const dir = join(versionsDir, name);
    try {
      // Drop the marker first so a half-removed folder is never launched.
      rmSync(join(dir, INSTALL_MARKER), { force: true });
      rmSync(dir, { recursive: true, force: true });
      removed.push(name);
    } catch {}
  }
  return removed;
}

function isRecent(path: string): boolean {
  try {
    return Date.now() - statSync(path).mtimeMs < UPDATE_RUN_LIMIT_MS;
  } catch {
    return false;
  }
}

const lockPathOf = (versionsDir: string): string => join(versionsDir, '.update.lock');

type LockState = 'held' | 'gone' | { stale: string };

function inspectLock(lockPath: string): LockState {
  let content: string;
  try {
    content = readFileSync(lockPath, 'utf8');
  } catch {
    return 'gone';
  }
  if (!isRecent(lockPath)) return { stale: content };
  // An empty file is a lock whose owner has not written its pid yet.
  if (content === '') return 'held';
  const owner = Number(content);
  return Number.isInteger(owner) && owner > 0 && isProcessAlive(owner)
    ? 'held'
    : { stale: content };
}

function takeOverStaleLock(lockPath: string, judged: string): void {
  const aside = `${lockPath}.${process.pid}`;
  try {
    renameSync(lockPath, aside);
  } catch {
    return;
  }
  try {
    if (readFileSync(aside, 'utf8') !== judged) linkSync(aside, lockPath);
  } catch {}
  rmSync(aside, { force: true });
}

function acquireLock(versionsDir: string): (() => void) | null {
  mkdirSync(versionsDir, { recursive: true });
  const lockPath = lockPathOf(versionsDir);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
      return () => {
        try {
          if (readFileSync(lockPath, 'utf8') === String(process.pid)) unlinkSync(lockPath);
        } catch {}
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const state = inspectLock(lockPath);
    if (state === 'held') return null;
    if (state !== 'gone') takeOverStaleLock(lockPath, state.stale);
  }
  return null;
}

export type UpdateOutcome =
  | { kind: 'disabled' }
  | { kind: 'not-due' }
  | { kind: 'busy' }
  | { kind: 'up-to-date'; version: string }
  | { kind: 'installed'; version: string; dir: string }
  | { kind: 'failed'; message: string };

function failedOutcome(error: unknown): UpdateOutcome {
  return { kind: 'failed', message: error instanceof Error ? error.message : String(error) };
}

function recordCheck(
  configDir: string,
  now: number,
  outcome: UpdateOutcome,
  latestVersion?: string,
): void {
  try {
    writeCheckState(configDir, {
      checkedAt: now,
      ...(latestVersion ? { latestVersion } : {}),
      result: outcome.kind === 'failed' ? `failed: ${outcome.message}` : outcome.kind,
    });
  } catch {}
}

export async function runUpdate(options: {
  scheduled: boolean;
  selfVersion?: string;
  env?: NodeJS.ProcessEnv;
  now?: number;
  paths?: UpdatePaths;
  fetchImpl?: typeof fetch;
  runInstall?: RunInstall;
  log?: (message: string) => void;
}): Promise<UpdateOutcome> {
  const {
    scheduled,
    selfVersion = pkg.version,
    env = process.env,
    now = Date.now(),
    paths = defaultPaths(),
    fetchImpl = fetch,
    runInstall,
    log = () => {},
  } = options;
  const { configDir, versionsDir } = paths;

  if (scheduled ? !isAutoUpdateEnabled(selfVersion, env) : !parseForkReleaseVersion(selfVersion)) {
    return { kind: 'disabled' };
  }

  let release: (() => void) | null;
  try {
    release = acquireLock(versionsDir);
  } catch (error) {
    const outcome = failedOutcome(error);
    recordCheck(configDir, now, outcome);
    return outcome;
  }
  if (!release) return { kind: 'busy' };
  try {
    if (scheduled && !isCheckDue(readCheckState(configDir), now)) return { kind: 'not-due' };

    const baseUrl = getReleaseBaseUrl(env);
    let outcome: UpdateOutcome;
    let latestVersion: string | undefined;
    try {
      latestVersion = await fetchLatestReleaseVersion(baseUrl, fetchImpl);
      const current = [selfVersion, ...listInstalledVersions(versionsDir)].sort((a, b) =>
        compareForkReleaseVersions(b, a),
      )[0];
      if (current && compareForkReleaseVersions(latestVersion, current) <= 0) {
        outcome = { kind: 'up-to-date', version: current };
      } else {
        log(`Installing difit ${latestVersion} into ${join(versionsDir, latestVersion)}`);
        const dir = await installReleaseVersion({
          version: latestVersion,
          baseUrl,
          versionsDir,
          ...(runInstall ? { runInstall } : {}),
        });
        outcome = { kind: 'installed', version: latestVersion, dir };
      }
    } catch (error) {
      outcome = failedOutcome(error);
    }

    recordCheck(configDir, now, outcome, latestVersion);
    try {
      cleanupVersions(versionsDir, readVersionsInUse(configDir, versionsDir));
    } catch {}
    return outcome;
  } finally {
    release();
  }
}

export function createUpdateCommand(): Command {
  return new Command('update')
    .description('install the newest difit fork release now (used from the next start)')
    .addOption(new Option('--scheduled').hideHelp())
    .action(async (options: { scheduled?: boolean }) => {
      const scheduled = options.scheduled === true;
      const outcome = await runUpdate({
        scheduled,
        log: scheduled ? () => {} : (message) => console.log(message),
      });
      if (scheduled) return;
      switch (outcome.kind) {
        case 'disabled':
          console.error(
            `Error: difit ${pkg.version} is not a fork release build. Install one first:\n` +
              `  npm i -g ${DEFAULT_RELEASE_BASE_URL}/releases/latest/download/difit.tgz`,
          );
          process.exit(1);
          break;
        case 'busy':
          console.error('Error: another difit update is running. Try again shortly.');
          process.exit(1);
          break;
        case 'failed':
          console.error(`Error: update failed: ${outcome.message}`);
          process.exit(1);
          break;
        case 'up-to-date':
          console.log(`difit ${outcome.version} is the newest release.`);
          break;
        case 'installed':
          console.log(`Installed difit ${outcome.version}. It runs from the next start.`);
          break;
        case 'not-due':
          break;
      }
    });
}
