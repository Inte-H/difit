import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { fetch as undiciFetch } from 'undici';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { INSTALL_MARKER, getVersionEntry, listInstalledVersions } from './versions.js';
import {
  CHECK_INTERVAL_MS,
  cleanupVersions,
  fetchLatestReleaseVersion,
  installReleaseVersion,
  isCheckDue,
  readCheckState,
  readVersionsInUse,
  registerRunningProcess,
  runUpdate,
  scheduleBackgroundUpdate,
  type RunInstall,
  type UpdatePaths,
} from './self-update.js';

const NOW = Date.UTC(2026, 9, 27, 12);
// The test setup replaces the global fetch with a mock.
const realFetch = undiciFetch as unknown as typeof fetch;

function writeFakePackage(root: string, version: string): void {
  mkdirSync(join(root, 'dist', 'cli'), { recursive: true });
  mkdirSync(join(root, 'dist', 'client'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'difit', version }));
  writeFileSync(join(root, 'dist', 'cli', 'index.js'), '');
  writeFileSync(join(root, 'dist', 'client', 'index.html'), '<html></html>');
}

const fakeInstall =
  (packageVersion?: string): RunInstall =>
  async (tarballUrl, prefix) => {
    const version = packageVersion ?? /difit-(.+)\.tgz$/.exec(tarballUrl)?.[1] ?? '';
    writeFakePackage(join(prefix, 'node_modules', 'difit'), version);
  };

function addInstalledVersion(versionsDir: string, version: string, complete = true): void {
  const dir = join(versionsDir, version);
  writeFakePackage(join(dir, 'node_modules', 'difit'), version);
  if (complete) writeFileSync(join(dir, INSTALL_MARKER), '{}');
}

function deadPid(): number {
  return spawnSync(process.execPath, ['-e', '']).pid ?? 0;
}

interface FakeReleaseServer {
  baseUrl: string;
  requests: string[];
  close: () => Promise<void>;
}

// Mimics github.com: /releases/latest redirects to the tag page and the
// versioned asset URL serves the tarball.
async function startFakeReleaseServer(options: {
  latest: string;
  tarballs?: Record<string, Buffer>;
}): Promise<FakeReleaseServer> {
  const requests: string[] = [];
  const server: Server = createServer((request, response) => {
    const url = request.url ?? '';
    requests.push(`${request.method} ${url}`);
    if (url === '/duru-app/difit/releases/latest') {
      const { port } = server.address() as AddressInfo;
      response.writeHead(302, {
        location: `http://127.0.0.1:${port}/duru-app/difit/releases/tag/v${options.latest}`,
      });
      response.end();
      return;
    }
    const asset = /^\/duru-app\/difit\/releases\/download\/v([^/]+)\/difit-([^/]+)\.tgz$/.exec(url);
    const tarball = asset && asset[1] === asset[2] ? options.tarballs?.[asset[1]] : undefined;
    if (tarball) {
      response.writeHead(200, { 'content-type': 'application/octet-stream' });
      response.end(tarball);
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}/duru-app/difit`,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

function packFakeRelease(workDir: string, version: string): Buffer {
  const source = join(workDir, `pack-${version}`);
  writeFakePackage(join(source, 'package'), version);
  const tarball = join(workDir, `difit-${version}.tgz`);
  const result = spawnSync('tar', ['-C', source, '-czf', tarball, 'package']);
  if (result.status !== 0) throw new Error(`tar failed: ${String(result.stderr)}`);
  return readFileSync(tarball);
}

describe('self-update', () => {
  let home: string;
  let paths: UpdatePaths;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'difit-self-update-'));
    paths = { configDir: join(home, '.difit'), versionsDir: join(home, '.difit', 'versions') };
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  describe('check interval', () => {
    it('checks again only after a day has passed', () => {
      expect(isCheckDue({}, NOW)).toBe(true);
      expect(isCheckDue({ checkedAt: NOW - CHECK_INTERVAL_MS + 1 }, NOW)).toBe(false);
      expect(isCheckDue({ checkedAt: NOW - CHECK_INTERVAL_MS }, NOW)).toBe(true);
      expect(isCheckDue({ checkedAt: NOW + 60_000 }, NOW)).toBe(true);
    });
  });

  describe('scheduling at launch', () => {
    const spawnStub = () => {
      const child = { on: vi.fn(), unref: vi.fn() };
      const spawnProcess = vi.fn(() => child);
      return { child, spawnProcess };
    };

    it('starts a detached update when a fork release has not checked today', () => {
      const { child, spawnProcess } = spawnStub();

      const started = scheduleBackgroundUpdate({
        selfVersion: '5.0.12-inteh.27',
        env: {},
        now: NOW,
        paths,
        entry: '/opt/difit/dist/cli/index.js',
        spawnProcess: spawnProcess as never,
      });

      expect(started).toBe(true);
      expect(spawnProcess).toHaveBeenCalledWith(
        process.execPath,
        ['/opt/difit/dist/cli/index.js', 'update', '--scheduled'],
        expect.objectContaining({
          detached: true,
          stdio: 'ignore',
          env: expect.objectContaining({ DIFIT_CONFIG_DIR: paths.configDir }),
        }),
      );
      const { cwd } = (spawnProcess.mock.calls[0] as unknown[])[2] as { cwd: string };
      expect(cwd).toBe(homedir());
      expect(child.unref).toHaveBeenCalled();
    });

    it('starts the update from the home folder even when the temp folder is missing', () => {
      const { spawnProcess } = spawnStub();
      vi.stubEnv('TMPDIR', join(home, 'missing-temp'));
      vi.stubEnv('TEMP', join(home, 'missing-temp'));
      vi.stubEnv('TMP', join(home, 'missing-temp'));
      try {
        scheduleBackgroundUpdate({
          selfVersion: '5.0.12-inteh.27',
          env: {},
          now: NOW,
          paths,
          entry: '/opt/difit/dist/cli/index.js',
          spawnProcess: spawnProcess as never,
        });
      } finally {
        vi.unstubAllEnvs();
      }

      const { cwd } = (spawnProcess.mock.calls[0] as unknown[])[2] as { cwd: string };
      expect(cwd).toBe(homedir());
    });

    it('hands the update an absolute config folder when it is given as a relative path', () => {
      const { spawnProcess } = spawnStub();
      const configDir = join('difit-relative-config');

      scheduleBackgroundUpdate({
        selfVersion: '5.0.12-inteh.27',
        env: {},
        now: NOW,
        paths: { configDir, versionsDir: join(configDir, 'versions') },
        entry: '/opt/difit/dist/cli/index.js',
        spawnProcess: spawnProcess as never,
      });

      expect(spawnProcess).toHaveBeenCalledWith(
        process.execPath,
        expect.any(Array),
        expect.objectContaining({
          env: expect.objectContaining({ DIFIT_CONFIG_DIR: resolve(configDir) }),
        }),
      );
      expect(existsSync(configDir)).toBe(false);
    });

    it.each([
      {
        name: 'the switch is set',
        selfVersion: '5.0.12-inteh.27',
        env: { DIFIT_DISABLE_AUTOUPDATE: '1' },
      },
      { name: 'it is a dev run', selfVersion: '5.0.12-inteh.27', env: { NODE_ENV: 'development' } },
      { name: 'it is a local build', selfVersion: '5.0.12-inteh.local.9cc690e', env: {} },
      { name: 'it is an upstream build', selfVersion: '5.0.12', env: {} },
    ])('does nothing when $name', ({ selfVersion, env }) => {
      const { spawnProcess } = spawnStub();

      expect(
        scheduleBackgroundUpdate({
          selfVersion,
          env,
          now: NOW,
          paths,
          spawnProcess: spawnProcess as never,
        }),
      ).toBe(false);
      expect(spawnProcess).not.toHaveBeenCalled();
    });

    it('does nothing when the last check was within a day', () => {
      mkdirSync(paths.configDir, { recursive: true });
      writeFileSync(
        join(paths.configDir, 'update-check.json'),
        JSON.stringify({ checkedAt: NOW - 60_000 }),
      );
      const { spawnProcess } = spawnStub();

      expect(
        scheduleBackgroundUpdate({
          selfVersion: '5.0.12-inteh.27',
          env: {},
          now: NOW,
          paths,
          spawnProcess: spawnProcess as never,
        }),
      ).toBe(false);
    });

    it('does not start another update while one holds the lock', () => {
      const { spawnProcess } = spawnStub();
      const schedule = () =>
        scheduleBackgroundUpdate({
          selfVersion: '5.0.12-inteh.27',
          env: {},
          now: NOW,
          paths,
          entry: '/opt/difit/dist/cli/index.js',
          spawnProcess: spawnProcess as never,
        });
      const lock = join(paths.versionsDir, '.update.lock');
      mkdirSync(paths.versionsDir, { recursive: true });

      writeFileSync(lock, String(process.ppid));
      expect(schedule()).toBe(false);

      writeFileSync(lock, String(deadPid()));
      expect(schedule()).toBe(true);

      writeFileSync(lock, String(process.ppid));
      const hourAgo = new Date(Date.now() - 60 * 60_000);
      utimesSync(lock, hourAgo, hourAgo);
      expect(schedule()).toBe(true);
    });
  });

  describe('looking up the latest release', () => {
    it('reads the version from the redirect of /releases/latest', async () => {
      const server = await startFakeReleaseServer({ latest: '5.0.12-inteh.30' });
      try {
        await expect(fetchLatestReleaseVersion(server.baseUrl, realFetch)).resolves.toBe(
          '5.0.12-inteh.30',
        );
      } finally {
        await server.close();
      }
    });

    it('rejects a latest release that is not a fork release', async () => {
      const server = await startFakeReleaseServer({ latest: '5.0.12-inteh.local.abc' });
      try {
        await expect(fetchLatestReleaseVersion(server.baseUrl, realFetch)).rejects.toThrow(
          /not a fork release/,
        );
      } finally {
        await server.close();
      }
    });

    it('gives up when the server does not answer in time', async () => {
      const server = createServer(() => {});
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const { port } = server.address() as AddressInfo;
      try {
        const startedAt = Date.now();
        await expect(
          fetchLatestReleaseVersion(`http://127.0.0.1:${port}/duru-app/difit`, realFetch, 200),
        ).rejects.toThrow();
        expect(Date.now() - startedAt).toBeLessThan(5_000);
      } finally {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      }
    });
  });

  describe('installing into a version folder', () => {
    it('installs the versioned asset with npm and marks the folder complete', async () => {
      const server = await startFakeReleaseServer({
        latest: '5.0.12-inteh.30',
        tarballs: { '5.0.12-inteh.30': packFakeRelease(home, '5.0.12-inteh.30') },
      });
      const previousCache = process.env.npm_config_cache;
      process.env.npm_config_cache = join(home, 'npm-cache');
      try {
        const dir = await installReleaseVersion({
          version: '5.0.12-inteh.30',
          baseUrl: server.baseUrl,
          versionsDir: paths.versionsDir,
        });

        expect(dir).toBe(join(paths.versionsDir, '5.0.12-inteh.30'));
        expect(existsSync(join(dir, INSTALL_MARKER))).toBe(true);
        expect(existsSync(getVersionEntry(dir))).toBe(true);
        expect(readdirSync(paths.versionsDir)).toEqual(['5.0.12-inteh.30']);
        expect(server.requests).toContain(
          'GET /duru-app/difit/releases/download/v5.0.12-inteh.30/difit-5.0.12-inteh.30.tgz',
        );
      } finally {
        if (previousCache === undefined) delete process.env.npm_config_cache;
        else process.env.npm_config_cache = previousCache;
        await server.close();
      }
    }, 60_000);

    it('leaves nothing behind when npm fails', async () => {
      const server = await startFakeReleaseServer({ latest: '5.0.12-inteh.30' });
      const previousCache = process.env.npm_config_cache;
      process.env.npm_config_cache = join(home, 'npm-cache');
      try {
        await expect(
          installReleaseVersion({
            version: '5.0.12-inteh.30',
            baseUrl: server.baseUrl,
            versionsDir: paths.versionsDir,
          }),
        ).rejects.toThrow(/npm install failed/);
        expect(readdirSync(paths.versionsDir)).toEqual([]);
      } finally {
        if (previousCache === undefined) delete process.env.npm_config_cache;
        else process.env.npm_config_cache = previousCache;
        await server.close();
      }
    }, 60_000);

    it('never marks a half-finished install', async () => {
      const halfInstall: RunInstall = async (_url, prefix) => {
        mkdirSync(join(prefix, 'node_modules', 'difit', 'dist', 'cli'), { recursive: true });
        writeFileSync(join(prefix, 'node_modules', 'difit', 'dist', 'cli', 'index.js'), '');
        throw new Error('connection reset');
      };

      await expect(
        installReleaseVersion({
          version: '5.0.12-inteh.30',
          baseUrl: 'http://127.0.0.1:1/duru-app/difit',
          versionsDir: paths.versionsDir,
          runInstall: halfInstall,
        }),
      ).rejects.toThrow('connection reset');
      expect(readdirSync(paths.versionsDir)).toEqual([]);
      expect(listInstalledVersions(paths.versionsDir)).toEqual([]);
    });

    it('keeps a finished copy of the same version instead of replacing it', async () => {
      addInstalledVersion(paths.versionsDir, '5.0.12-inteh.30');
      const entry = getVersionEntry(join(paths.versionsDir, '5.0.12-inteh.30'));
      writeFileSync(entry, '// running copy');

      await installReleaseVersion({
        version: '5.0.12-inteh.30',
        baseUrl: 'http://127.0.0.1:1/duru-app/difit',
        versionsDir: paths.versionsDir,
        runInstall: fakeInstall(),
      });

      expect(readFileSync(entry, 'utf8')).toBe('// running copy');
      expect(readdirSync(paths.versionsDir)).toEqual(['5.0.12-inteh.30']);
    });

    it('repairs a marked copy whose entry file is gone', async () => {
      addInstalledVersion(paths.versionsDir, '5.0.12-inteh.30');
      const entry = getVersionEntry(join(paths.versionsDir, '5.0.12-inteh.30'));
      rmSync(entry);

      await installReleaseVersion({
        version: '5.0.12-inteh.30',
        baseUrl: 'http://127.0.0.1:1/duru-app/difit',
        versionsDir: paths.versionsDir,
        runInstall: fakeInstall(),
      });

      expect(listInstalledVersions(paths.versionsDir)).toEqual(['5.0.12-inteh.30']);
    });

    it('rejects a package whose version differs from the release', async () => {
      await expect(
        installReleaseVersion({
          version: '5.0.12-inteh.30',
          baseUrl: 'http://127.0.0.1:1/duru-app/difit',
          versionsDir: paths.versionsDir,
          runInstall: fakeInstall('5.0.12-inteh.29'),
        }),
      ).rejects.toThrow(/reports version 5.0.12-inteh.29/);
      expect(listInstalledVersions(paths.versionsDir)).toEqual([]);
    });
  });

  describe('running processes', () => {
    it('records a difit started from a version folder and reads it back while it lives', () => {
      addInstalledVersion(paths.versionsDir, '5.0.12-inteh.28');
      const packageRoot = join(paths.versionsDir, '5.0.12-inteh.28', 'node_modules', 'difit');

      registerRunningProcess({ configDir: paths.configDir, packageRoot });

      expect(readdirSync(join(paths.configDir, 'running'))).toEqual([`${process.pid}.json`]);
      expect([...readVersionsInUse(paths.configDir, paths.versionsDir)]).toEqual([
        '5.0.12-inteh.28',
      ]);
    });

    it('skips a difit that does not run from a version folder', () => {
      registerRunningProcess({ configDir: paths.configDir, packageRoot: home });

      expect(existsSync(join(paths.configDir, 'running'))).toBe(false);
    });

    it('drops entries and leftover temp files of processes that have ended', () => {
      const runningDir = join(paths.configDir, 'running');
      mkdirSync(runningDir, { recursive: true });
      const pid = deadPid();
      writeFileSync(join(runningDir, `${pid}.json.tmp`), '{"pid"');
      writeFileSync(
        join(runningDir, `${pid}.json`),
        JSON.stringify({ pid, packageRoot: join(paths.versionsDir, '5.0.12-inteh.1') }),
      );

      expect(readVersionsInUse(paths.configDir, paths.versionsDir).size).toBe(0);
      expect(readdirSync(runningDir)).toEqual([]);
    });
  });

  describe('cleanup', () => {
    it('keeps the two newest, every version in use and live installs, and removes the rest', () => {
      for (const n of [1, 2, 3, 4, 5]) addInstalledVersion(paths.versionsDir, `5.0.12-inteh.${n}`);
      addInstalledVersion(paths.versionsDir, '5.0.12-inteh.6', false);
      const deadStaging = `.staging-5.0.12-inteh.7-${deadPid()}`;
      const liveStaging = `.staging-5.0.12-inteh.8-${process.ppid}`;
      mkdirSync(join(paths.versionsDir, deadStaging));
      mkdirSync(join(paths.versionsDir, liveStaging));
      mkdirSync(join(paths.versionsDir, 'notes'));

      const removed = cleanupVersions(paths.versionsDir, new Set(['5.0.12-inteh.2']));

      expect(removed.sort()).toEqual(
        [deadStaging, '5.0.12-inteh.1', '5.0.12-inteh.3', '5.0.12-inteh.6'].sort(),
      );
      expect(readdirSync(paths.versionsDir).sort()).toEqual(
        [liveStaging, '5.0.12-inteh.2', '5.0.12-inteh.4', '5.0.12-inteh.5', 'notes'].sort(),
      );
    });

    it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
      'removes the other folders when one cannot be removed',
      () => {
        for (const n of [1, 2, 3, 4, 5])
          addInstalledVersion(paths.versionsDir, `5.0.12-inteh.${n}`);
        const locked = join(paths.versionsDir, '5.0.12-inteh.2', 'node_modules', 'difit', 'dist');
        chmodSync(locked, 0o555);
        try {
          const removed = cleanupVersions(paths.versionsDir, new Set());

          expect(removed.sort()).toEqual(['5.0.12-inteh.1', '5.0.12-inteh.3']);
          expect(existsSync(join(paths.versionsDir, '5.0.12-inteh.1'))).toBe(false);
          expect(existsSync(join(paths.versionsDir, '5.0.12-inteh.3'))).toBe(false);
        } finally {
          chmodSync(locked, 0o755);
        }
      },
    );
  });

  describe('runUpdate', () => {
    const run = (overrides: Partial<Parameters<typeof runUpdate>[0]> & { baseUrl: string }) => {
      const { baseUrl, ...rest } = overrides;
      return runUpdate({
        scheduled: true,
        selfVersion: '5.0.12-inteh.27',
        env: { DIFIT_UPDATE_BASE_URL: baseUrl },
        now: NOW,
        paths,
        fetchImpl: realFetch,
        runInstall: fakeInstall(),
        ...rest,
      });
    };

    it('installs a newer release, records the check, and waits a day before the next one', async () => {
      const server = await startFakeReleaseServer({ latest: '5.0.12-inteh.30' });
      try {
        await expect(run({ baseUrl: server.baseUrl })).resolves.toMatchObject({
          kind: 'installed',
          version: '5.0.12-inteh.30',
        });
        expect(listInstalledVersions(paths.versionsDir)).toEqual(['5.0.12-inteh.30']);
        expect(readCheckState(paths.configDir)).toMatchObject({
          checkedAt: NOW,
          latestVersion: '5.0.12-inteh.30',
          result: 'installed',
        });

        await expect(run({ baseUrl: server.baseUrl, now: NOW + 1000 })).resolves.toEqual({
          kind: 'not-due',
        });
        expect(server.requests.filter((r) => r.includes('/releases/latest'))).toHaveLength(1);
      } finally {
        await server.close();
      }
    });

    it('does not install when the running or an installed version is already the latest', async () => {
      const server = await startFakeReleaseServer({ latest: '5.0.12-inteh.30' });
      addInstalledVersion(paths.versionsDir, '5.0.12-inteh.30');
      const runInstall = vi.fn<RunInstall>();
      try {
        await expect(run({ baseUrl: server.baseUrl, runInstall })).resolves.toEqual({
          kind: 'up-to-date',
          version: '5.0.12-inteh.30',
        });
        expect(runInstall).not.toHaveBeenCalled();
      } finally {
        await server.close();
      }
    });

    it('still cleans up old versions when the check time cannot be written', async () => {
      const server = await startFakeReleaseServer({ latest: '5.0.12-inteh.27' });
      for (const n of [24, 25, 26]) addInstalledVersion(paths.versionsDir, `5.0.12-inteh.${n}`);
      mkdirSync(join(paths.configDir, 'update-check.json'), { recursive: true });
      try {
        await expect(run({ baseUrl: server.baseUrl })).resolves.toMatchObject({
          kind: 'up-to-date',
        });
        expect(listInstalledVersions(paths.versionsDir)).toEqual([
          '5.0.12-inteh.26',
          '5.0.12-inteh.25',
        ]);
      } finally {
        await server.close();
      }
    });

    it('fails and waits a day when the versions folder cannot be created', async () => {
      mkdirSync(paths.configDir, { recursive: true });
      writeFileSync(paths.versionsDir, '');

      await expect(run({ baseUrl: 'http://127.0.0.1:1' })).resolves.toMatchObject({
        kind: 'failed',
      });
      expect(readCheckState(paths.configDir)).toMatchObject({ checkedAt: NOW });
      const spawnProcess = vi.fn(() => ({ on: vi.fn(), unref: vi.fn() }));
      expect(
        scheduleBackgroundUpdate({
          selfVersion: '5.0.12-inteh.27',
          env: {},
          now: NOW + 60_000,
          paths,
          spawnProcess: spawnProcess as never,
        }),
      ).toBe(false);
      expect(spawnProcess).not.toHaveBeenCalled();
    });

    it('records a failed lookup so the next try waits a day', async () => {
      const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'));

      await expect(run({ baseUrl: 'http://127.0.0.1:1', fetchImpl })).resolves.toEqual({
        kind: 'failed',
        message: 'offline',
      });
      expect(readCheckState(paths.configDir)).toMatchObject({
        checkedAt: NOW,
        result: 'failed: offline',
      });
    });

    it('leaves the work to an update that is already running', async () => {
      mkdirSync(paths.versionsDir, { recursive: true });
      writeFileSync(join(paths.versionsDir, '.update.lock'), String(process.pid));
      const fetchImpl = vi.fn<typeof fetch>();

      await expect(run({ baseUrl: 'http://127.0.0.1:1', fetchImpl })).resolves.toEqual({
        kind: 'busy',
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('takes over a lock whose owner pid is alive but far too old to be an update', async () => {
      const server = await startFakeReleaseServer({ latest: '5.0.12-inteh.27' });
      mkdirSync(paths.versionsDir, { recursive: true });
      const lock = join(paths.versionsDir, '.update.lock');
      writeFileSync(lock, String(process.ppid));
      const hourAgo = new Date(Date.now() - 60 * 60_000);
      utimesSync(lock, hourAgo, hourAgo);
      try {
        await expect(run({ baseUrl: server.baseUrl })).resolves.toMatchObject({
          kind: 'up-to-date',
        });
      } finally {
        await server.close();
      }
    });

    it('takes over a lock holding something other than a pid', async () => {
      const server = await startFakeReleaseServer({ latest: '5.0.12-inteh.27' });
      mkdirSync(paths.versionsDir, { recursive: true });
      writeFileSync(join(paths.versionsDir, '.update.lock'), 'garbage');
      try {
        await expect(run({ baseUrl: server.baseUrl })).resolves.toMatchObject({
          kind: 'up-to-date',
        });
      } finally {
        await server.close();
      }
    });

    it('treats a fresh lock without a pid yet as held', async () => {
      mkdirSync(paths.versionsDir, { recursive: true });
      writeFileSync(join(paths.versionsDir, '.update.lock'), '');

      await expect(run({ baseUrl: 'http://127.0.0.1:1' })).resolves.toEqual({ kind: 'busy' });
    });

    it('takes over a lock left by an update that died', async () => {
      const server = await startFakeReleaseServer({ latest: '5.0.12-inteh.27' });
      mkdirSync(paths.versionsDir, { recursive: true });
      writeFileSync(join(paths.versionsDir, '.update.lock'), String(deadPid()));
      try {
        await expect(run({ baseUrl: server.baseUrl })).resolves.toMatchObject({
          kind: 'up-to-date',
        });
        expect(existsSync(join(paths.versionsDir, '.update.lock'))).toBe(false);
      } finally {
        await server.close();
      }
    });

    it('lets `difit update` run at once even when the check is off or not due', async () => {
      const server = await startFakeReleaseServer({ latest: '5.0.12-inteh.31' });
      mkdirSync(paths.configDir, { recursive: true });
      writeFileSync(join(paths.configDir, 'update-check.json'), JSON.stringify({ checkedAt: NOW }));
      try {
        await expect(
          run({
            baseUrl: server.baseUrl,
            scheduled: false,
            env: { DIFIT_UPDATE_BASE_URL: server.baseUrl, DIFIT_DISABLE_AUTOUPDATE: '1' },
          }),
        ).resolves.toMatchObject({ kind: 'installed', version: '5.0.12-inteh.31' });
      } finally {
        await server.close();
      }
    });

    it('refuses `difit update` from a local build', async () => {
      await expect(
        run({
          baseUrl: 'http://127.0.0.1:1',
          scheduled: false,
          selfVersion: '5.0.12-inteh.local.9cc690e',
        }),
      ).resolves.toEqual({ kind: 'disabled' });
    });
  });
});
