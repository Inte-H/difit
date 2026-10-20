import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import type { DiffSide } from '../types/diff.js';

import { runGit } from './run-git.js';

export interface FixupTargetQuery {
  view: { base: string; target: string };
  filePath: string;
  // 1-based and inclusive, counted on the given side of the view.
  startLine: number;
  endLine: number;
  side: DiffSide;
  // Oldest first, full SHAs; every commit in the view's range when left out.
  commits?: readonly string[];
}

async function gitText(repoPath: string, args: string[]): Promise<string> {
  const run = await runGit(repoPath, args);
  if (run.code !== 0) {
    throw new Error(`git ${args[0]} failed: ${run.output}`);
  }
  return run.stdout.toString('utf8').trim();
}

// The commit of the view that last changed the lines, the latest one when they came from several;
// the view's last commit for lines the view left as they were and for lines on the old side. Lines a
// commit outside `commits` changed count for the commit they came from before it.
export async function chooseFixupTarget(
  repoPath: string,
  { view, filePath, startLine, endLine, side, commits }: FixupTargetQuery,
): Promise<string> {
  const [base, target] = await Promise.all(
    [view.base, view.target].map((commitish) =>
      gitText(repoPath, ['rev-parse', '--verify', `${commitish}^{commit}`]),
    ),
  );
  const last = commits?.at(-1) ?? target;
  if (side === 'old') return last;
  const inRange = (await gitText(repoPath, ['rev-list', '--reverse', `${base}..${target}`])).split(
    '\n',
  );
  const listed = commits ?? inRange;
  const given = new Set(listed);
  const passedOver = inRange.filter((sha) => sha && !given.has(sha));
  const blame = await withIgnoredRevs(passedOver, (ignoring) =>
    gitText(repoPath, [
      'blame',
      '--porcelain',
      '--no-ignore-revs-file',
      ...ignoring,
      '-L',
      `${startLine},${endLine}`,
      `${base}..${target}`,
      '--',
      filePath,
    ]),
  );
  const authors = new Set(
    blame.split('\n').map((line) => /^([0-9a-f]{40,64}) \d+ \d+/.exec(line)?.[1]),
  );
  return [...listed].reverse().find((sha) => authors.has(sha)) ?? last;
}

async function withIgnoredRevs<T>(
  revs: readonly string[],
  work: (args: string[]) => Promise<T>,
): Promise<T> {
  if (revs.length === 0) return work([]);
  const dir = await fs.mkdtemp(join(tmpdir(), 'difit-fixup-target-'));
  try {
    const file = join(dir, 'ignore-revs');
    await fs.writeFile(file, `${revs.join('\n')}\n`);
    return await work(['--ignore-revs-file', file]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
