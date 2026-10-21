import type { MergedCommit, ReviewCommit } from '../types/diff.js';

// Lane 0 is the first-parent line of the review; lane 1 is the branch a merge brings in, drawn in
// the colour of its branch: the branches are numbered in the order of their merges. The branch runs
// straight beside its commits and curves only in the rows of the commit above it (`forkBelow`) and of
// its merge (`join`). Below a merge the branch curves off in its own first row (`fork`) instead; when
// the review's first commit is a merge, its branch comes straight down from outside the list.
export interface CommitGraphCell {
  above: boolean;
  below: boolean;
  dot: { lane: 0 | 1 } | null;
  branch: { shape: 'fork' | 'through' | 'join'; color: number } | null;
  forkBelow: number | null;
}

type CommitGraphMergedRow =
  | { kind: 'commit'; commit: MergedCommit; cell: CommitGraphCell }
  | { kind: 'omitted'; count: number; cell: CommitGraphCell };

export interface CommitGraphRow {
  commit: ReviewCommit;
  cell: CommitGraphCell;
  // Drawn just above the merge, oldest first.
  merged: CommitGraphMergedRow[];
}

export function layoutCommitGraph(commits: readonly ReviewCommit[]): CommitGraphRow[] {
  const entriesOf = (commit: ReviewCommit) => [
    ...(commit.mergedOmitted ? [{ kind: 'omitted' as const, count: commit.mergedOmitted }] : []),
    ...(commit.merged ?? []).map((mergedCommit) => ({
      kind: 'commit' as const,
      commit: mergedCommit,
    })),
  ];
  const branchOf = new Map<number, number>();
  commits.forEach((commit, index) => {
    if (commit.merged?.length || commit.mergedOmitted) branchOf.set(index, branchOf.size);
  });

  return commits.map((commit, index) => {
    const color = branchOf.get(index) ?? 0;
    const merged = entriesOf(commit).map(
      (entry, position): CommitGraphMergedRow => ({
        ...entry,
        cell: {
          above: true,
          below: true,
          dot: entry.kind === 'commit' ? { lane: 1 } : null,
          branch: { shape: position === 0 && branchOf.has(index - 1) ? 'fork' : 'through', color },
          forkBelow: null,
        },
      }),
    );

    return {
      commit,
      cell: {
        above: true,
        below: index < commits.length - 1,
        dot: { lane: 0 },
        branch: merged.length > 0 ? { shape: 'join', color } : null,
        forkBelow: branchOf.has(index) ? null : (branchOf.get(index + 1) ?? null),
      },
      merged,
    };
  });
}
