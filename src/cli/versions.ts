import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { getDifitConfigDir } from '../server/user-config.js';

// Only fork release builds take part in versioned installs. Local builds
// (`5.0.12-inteh.local.<sha>`) and upstream versions never match.
const FORK_RELEASE_VERSION = /^(\d+)\.(\d+)\.(\d+)-inteh\.(\d+)$/;

export const INSTALL_MARKER = '.difit-installed.json';

export function parseForkReleaseVersion(version: string): number[] | null {
  const match = FORK_RELEASE_VERSION.exec(version);
  return match ? match.slice(1).map(Number) : null;
}

export function compareForkReleaseVersions(a: string, b: string): number {
  const left = parseForkReleaseVersion(a);
  const right = parseForkReleaseVersion(b);
  if (!left || !right) {
    throw new Error(`Not a fork release version: ${left ? b : a}`);
  }
  for (let index = 0; index < left.length; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
}

export function getVersionsDir(configDir: string = getDifitConfigDir()): string {
  return join(configDir, 'versions');
}

export function getVersionEntry(versionDir: string): string {
  return join(versionDir, 'node_modules', 'difit', 'dist', 'cli', 'index.js');
}

export function isCompleteVersion(versionDir: string): boolean {
  return existsSync(join(versionDir, INSTALL_MARKER)) && existsSync(getVersionEntry(versionDir));
}

// Newest first.
export function listInstalledVersions(versionsDir: string = getVersionsDir()): string[] {
  let names: string[];
  try {
    names = readdirSync(versionsDir);
  } catch {
    return [];
  }
  return names
    .filter(
      (name) =>
        parseForkReleaseVersion(name) !== null && isCompleteVersion(join(versionsDir, name)),
    )
    .sort((a, b) => compareForkReleaseVersions(b, a));
}

export function pickLaunchTarget(
  selfVersion: string,
  versionsDir: string = getVersionsDir(),
): string | null {
  if (!parseForkReleaseVersion(selfVersion)) return null;
  const newest = listInstalledVersions(versionsDir)[0];
  if (!newest || compareForkReleaseVersions(newest, selfVersion) <= 0) return null;
  return getVersionEntry(join(versionsDir, newest));
}

export async function launchNewestCopy(options: {
  selfVersion: string;
  ownEntry: string;
  runOwnCli: () => Promise<unknown>;
  versionsDir?: string;
}): Promise<void> {
  let target: string | null = null;
  try {
    target = pickLaunchTarget(options.selfVersion, options.versionsDir);
  } catch {}
  if (target) {
    process.argv[1] = target;
    try {
      await import(pathToFileURL(target).href);
      return;
    } catch (error) {
      console.error(
        `difit: could not start ${target} (${error instanceof Error ? error.message : String(error)}); running ${options.selfVersion}`,
      );
    }
  }
  // Background children re-run argv[1]; point it at the CLI, not the launcher.
  process.argv[1] = options.ownEntry;
  await options.runOwnCli();
}
