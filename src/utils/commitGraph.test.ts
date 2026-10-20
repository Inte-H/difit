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

function draw(cell: CommitGraphCell): string {
  const line = (drawn: boolean) => (drawn ? 'l' : '-');
  const dot = !cell.dot ? '-' : cell.dot.lane === 0 ? 'C' : 'B';
  const branch = cell.branch ? `${cell.branch.shape[0]}${cell.branch.color}` : '-';
  const fork = cell.forkBelow === null ? '' : ` v${cell.forkBelow}`;
  return `${line(cell.above)}${dot}${line(cell.below)}${branch}${fork}`;
}

function drawAll(commits: ReviewCommit[]): string[] {
  return layoutCommitGraph(commits).flatMap((row) => [
    ...row.merged.map(
      (entry) =>
        `${entry.kind === 'commit' ? entry.commit.shortSha : `+${entry.count}`} ${draw(entry.cell)}`,
    ),
    `${row.commit.shortSha} ${draw(row.cell)}`,
  ]);
}

describe('layoutCommitGraph', () => {
  it('draws a straight range as one line with a dot per commit, ending at the newest', () => {
    expect(drawAll([commit('a'), commit('b'), commit('c')])).toEqual([
      'a lCl-',
      'b lCl-',
      'c lC--',
    ]);
  });

  it('keeps the branch straight beside its commits, curving off below the commit above and into the merge', () => {
    expect(drawAll([commit('a'), commit('m', ['x', 'y']), commit('b')])).toEqual([
      'a lCl- v0',
      'x lBlt0',
      'y lBlt0',
      'm lClj0',
      'b lC--',
    ]);
  });

  it('gives every merge its own branch, numbered in the order of the merges', () => {
    expect(drawAll([commit('m1', ['x']), commit('m2', ['y', 'z'])])).toEqual([
      'x lBlf0',
      'm1 lClj0 v1',
      'y lBlt1',
      'z lBlt1',
      'm2 lC-j1',
    ]);
  });

  it('opens a branch whose oldest commits are only counted with the count and no dot', () => {
    expect(drawAll([commit('m', ['x'], 3)])).toEqual(['+3 l-lf0', 'x lBlt0', 'm lC-j0']);
  });

  it('draws nothing for no commits', () => {
    expect(drawAll([commit('a')])).toEqual(['a lC--']);
    expect(layoutCommitGraph([])).toEqual([]);
  });
});
