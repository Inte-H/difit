import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  INSTALL_MARKER,
  compareForkReleaseVersions,
  getVersionEntry,
  launchNewestCopy,
  listInstalledVersions,
  parseForkReleaseVersion,
  pickLaunchTarget,
} from './versions.js';

function addVersion(
  versionsDir: string,
  version: string,
  options: { complete?: boolean; source?: string } = {},
) {
  const dir = join(versionsDir, version);
  mkdirSync(join(dir, 'node_modules', 'difit', 'dist', 'cli'), { recursive: true });
  writeFileSync(getVersionEntry(dir), options.source ?? '');
  if (options.complete !== false) {
    writeFileSync(join(dir, INSTALL_MARKER), '{}');
  }
}

describe('fork release versions', () => {
  it('accepts only fork release builds', () => {
    expect(parseForkReleaseVersion('5.0.12-inteh.27')).toEqual([5, 0, 12, 27]);
    expect(parseForkReleaseVersion('5.0.12')).toBeNull();
    expect(parseForkReleaseVersion('5.0.12-inteh.local.9cc690e')).toBeNull();
    expect(parseForkReleaseVersion('5.0.12-inteh.27.1')).toBeNull();
  });

  it('orders by the upstream version first and the release number second', () => {
    expect(compareForkReleaseVersions('5.0.12-inteh.9', '5.0.12-inteh.10')).toBe(-1);
    expect(compareForkReleaseVersions('5.0.13-inteh.1', '5.0.12-inteh.40')).toBe(1);
    expect(compareForkReleaseVersions('5.0.12-inteh.27', '5.0.12-inteh.27')).toBe(0);
    expect(() => compareForkReleaseVersions('5.0.12-inteh.local.x', '5.0.12-inteh.1')).toThrow();
  });
});

describe('picking the version to launch', () => {
  let versionsDir: string;

  beforeEach(() => {
    versionsDir = mkdtempSync(join(tmpdir(), 'difit-versions-'));
  });

  afterEach(() => {
    rmSync(versionsDir, { recursive: true, force: true });
  });

  it('lists complete installs newest first and skips unfinished or foreign folders', () => {
    addVersion(versionsDir, '5.0.12-inteh.9');
    addVersion(versionsDir, '5.0.12-inteh.11');
    addVersion(versionsDir, '5.0.12-inteh.12', { complete: false });
    mkdirSync(join(versionsDir, '.staging-5.0.12-inteh.13-42'));
    mkdirSync(join(versionsDir, 'notes'));

    expect(listInstalledVersions(versionsDir)).toEqual(['5.0.12-inteh.11', '5.0.12-inteh.9']);
  });

  it('runs the newest complete version when it is newer than the launcher', () => {
    addVersion(versionsDir, '5.0.12-inteh.20');
    addVersion(versionsDir, '5.0.12-inteh.21');
    addVersion(versionsDir, '5.0.12-inteh.22', { complete: false });

    expect(pickLaunchTarget('5.0.12-inteh.19', versionsDir)).toBe(
      getVersionEntry(join(versionsDir, '5.0.12-inteh.21')),
    );
  });

  it('runs the launcher itself when no installed version is newer', () => {
    addVersion(versionsDir, '5.0.12-inteh.20');

    expect(pickLaunchTarget('5.0.12-inteh.20', versionsDir)).toBeNull();
    expect(pickLaunchTarget('5.0.12-inteh.25', versionsDir)).toBeNull();
    expect(pickLaunchTarget('5.0.12-inteh.1', join(versionsDir, 'missing'))).toBeNull();
  });

  it('never hands a local or upstream build over to an installed version', () => {
    addVersion(versionsDir, '5.0.12-inteh.20');

    expect(pickLaunchTarget('5.0.12-inteh.local.9cc690e', versionsDir)).toBeNull();
    expect(pickLaunchTarget('5.0.12', versionsDir)).toBeNull();
  });
});

describe('handing the run over', () => {
  let versionsDir: string;
  let originalArgv1: string | undefined;
  const ownEntry = '/usr/lib/node_modules/difit/dist/cli/index.js';
  const launched = () => (globalThis as { difitLaunched?: string }).difitLaunched;

  beforeEach(() => {
    versionsDir = mkdtempSync(join(tmpdir(), 'difit-handoff-'));
    originalArgv1 = process.argv[1];
    delete (globalThis as { difitLaunched?: string }).difitLaunched;
  });

  afterEach(() => {
    if (originalArgv1 !== undefined) process.argv[1] = originalArgv1;
    rmSync(versionsDir, { recursive: true, force: true });
  });

  it('runs the newer installed copy instead of its own CLI', async () => {
    addVersion(versionsDir, '5.0.12-inteh.6', {
      source: "globalThis.difitLaunched = '5.0.12-inteh.6';\n",
    });
    const runOwnCli = vi.fn(async () => {});

    await launchNewestCopy({ selfVersion: '5.0.12-inteh.5', ownEntry, runOwnCli, versionsDir });

    expect(launched()).toBe('5.0.12-inteh.6');
    expect(runOwnCli).not.toHaveBeenCalled();
    expect(process.argv[1]).toBe(getVersionEntry(join(versionsDir, '5.0.12-inteh.6')));
  });

  it('runs its own CLI when the newer copy fails to load', async () => {
    addVersion(versionsDir, '5.0.12-inteh.6', { source: 'import "./missing-module.js";\n' });
    const runOwnCli = vi.fn(async () => {});

    await launchNewestCopy({ selfVersion: '5.0.12-inteh.5', ownEntry, runOwnCli, versionsDir });

    expect(runOwnCli).toHaveBeenCalledOnce();
    expect(process.argv[1]).toBe(ownEntry);
  });

  it('runs its own CLI when nothing newer is installed', async () => {
    addVersion(versionsDir, '5.0.12-inteh.4', {
      source: "globalThis.difitLaunched = '5.0.12-inteh.4';\n",
    });
    const runOwnCli = vi.fn(async () => {});

    await launchNewestCopy({ selfVersion: '5.0.12-inteh.5', ownEntry, runOwnCli, versionsDir });

    expect(launched()).toBeUndefined();
    expect(runOwnCli).toHaveBeenCalledOnce();
    expect(process.argv[1]).toBe(ownEntry);
  });
});
