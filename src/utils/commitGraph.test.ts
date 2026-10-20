import { describe, expect, it } from 'vitest';

import type { MergedCommit, ReviewCommit } from '../types/diff';

import { layoutCommitGraph, type CommitGraphCell } from './commitGraph';

const sha = (name: string) => name.padEnd(40, '0');
const commit = (name: string, merged?: string[], mergedOmitted?: number): ReviewCommit => ({
  sha: sha(name),
  shortSha: name,
  parentSha: sha(`${name}-parent`),
  subject: name,
  ...(merged ? { merged: merged.map(mergedCommit) } : {}),
  ...(mergedOmitted ? { mergedOmitted } : {}),
});
const mergedCommit = (name: string): MergedCommit => ({
  sha: sha(name),
  shortSha: name,
  subject: name,
});

// One letter per part: the first-parent line above and below the dot (l lit, d dim, - none), the
// dot (C commit, c lit commit, B branch commit, b lit branch commit, - none) and the branch line
// (f fork, t through, j join, upper case when lit, - none).
function draw(cell: CommitGraphCell): string {
  const line = (stroke: CommitGraphCell['above']) =>
    stroke === 'lit' ? 'l' : stroke === 'dim' ? 'd' : '-';
  const dot = !cell.dot
    ? '-'
    : cell.dot.lane === 0
      ? cell.dot.lit
        ? 'c'
        : 'C'
      : cell.dot.lit
        ? 'b'
        : 'B';
  const branch = !cell.branch
    ? '-'
    : cell.branch.lit
      ? cell.branch.shape[0]!.toUpperCase()
      : cell.branch.shape[0]!;
  return `${line(cell.above)}${dot}${line(cell.below)}${branch}`;
}

function drawAll(commits: ReviewCommit[], shown: [number, number] | null): string[] {
  return layoutCommitGraph(commits, shown).flatMap((row) => [
    ...row.merged.map(
      (entry) =>
        `${entry.kind === 'commit' ? entry.commit.shortSha : `+${entry.count}`} ${draw(entry.cell)}`,
    ),
    `${row.commit.shortSha} ${draw(row.cell)}`,
  ]);
}

describe('layoutCommitGraph', () => {
  it('draws a straight range as one line with a dot per commit, ending at the newest', () => {
    expect(drawAll([commit('a'), commit('b'), commit('c')], null)).toEqual([
      'a dCd-',
      'b dCd-',
      'c dC--',
    ]);
  });

  it('lights the shown commits and the line from just before the first to the last', () => {
    expect(drawAll([commit('a'), commit('b'), commit('c'), commit('d')], [1, 2])).toEqual([
      'a dCl-',
      'b lcl-',
      'c lcd-',
      'd dC--',
    ]);
  });

  it('draws the commits a merge brings in on a branch that forks above them and joins at the merge', () => {
    expect(drawAll([commit('a'), commit('m', ['x', 'y']), commit('b')], null)).toEqual([
      'a dCd-',
      'x dBdf',
      'y dBdt',
      'm dCdj',
      'b dC--',
    ]);
  });

  it('gives every merge its own branch', () => {
    expect(drawAll([commit('m1', ['x']), commit('m2', ['y', 'z'])], null)).toEqual([
      'x dBdf',
      'm1 dCdj',
      'y dBdf',
      'z dBdt',
      'm2 dC-j',
    ]);
  });

  it('lights the branch of a shown merge with it', () => {
    expect(drawAll([commit('a'), commit('m', ['x']), commit('b')], [1, 2])).toEqual([
      'a dCl-',
      'x lblF',
      'm lclJ',
      'b lc--',
    ]);
  });

  it('leaves the branch of a merge outside the shown range dim', () => {
    expect(drawAll([commit('m', ['x']), commit('b')], [1, 1])).toEqual([
      'x dBdf',
      'm dClj',
      'b lc--',
    ]);
  });

  it('opens a branch whose oldest commits are only counted with the count and no dot', () => {
    expect(drawAll([commit('m', ['x'], 3)], null)).toEqual(['+3 d-df', 'x dBdt', 'm dC-j']);
  });

  it('lights nothing when nothing is shown and draws nothing for no commits', () => {
    expect(drawAll([commit('a')], null)).toEqual(['a dC--']);
    expect(layoutCommitGraph([], [0, 0])).toEqual([]);
  });
});
