import type { MergedCommit, ReviewCommit } from '../types/diff.js';

// Lane 0 is the first-parent line of the review; lane 1 is the branch a merge brings in, drawn in
// the colour of its branch: the branches are numbered in the order of their merges.
export interface CommitGraphCell {
  above: boolean;
  below: boolean;
  dot: { lane: 0 | 1 } | null;
  branch: { shape: 'fork' | 'through' | 'join'; color: number } | null;
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
  let branches = 0;
  return commits.map((commit, index) => {
    const entries = [
      ...(commit.mergedOmitted ? [{ kind: 'omitted' as const, count: commit.mergedOmitted }] : []),
      ...(commit.merged ?? []).map((mergedCommit) => ({
        kind: 'commit' as const,
        commit: mergedCommit,
      })),
    ];
    const color = entries.length > 0 ? branches++ : 0;
    const merged = entries.map(
      (entry, position): CommitGraphMergedRow => ({
        ...entry,
        cell: {
          above: true,
          below: true,
          dot: entry.kind === 'commit' ? { lane: 1 } : null,
          branch: { shape: position === 0 ? 'fork' : 'through', color },
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
      },
      merged,
    };
  });
}
