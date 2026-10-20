import type { MergedCommit, ReviewCommit } from '../types/diff.js';

export type CommitGraphStroke = 'lit' | 'dim';

// Lane 0 is the first-parent line of the review; lane 1 is the branch a merge brings in.
export interface CommitGraphCell {
  above: CommitGraphStroke | null;
  below: CommitGraphStroke | null;
  dot: { lane: 0 | 1; lit: boolean } | null;
  branch: { shape: 'fork' | 'through' | 'join'; lit: boolean } | null;
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

// `shown` holds the indexes of the first and last shown commit; a merge's branch is lit with it,
// since its diff against the first parent holds the branch.
export function layoutCommitGraph(
  commits: readonly ReviewCommit[],
  shown: readonly [number, number] | null,
): CommitGraphRow[] {
  const isLit = (index: number) => shown !== null && index >= shown[0] && index <= shown[1];
  const stroke = (lit: boolean): CommitGraphStroke => (lit ? 'lit' : 'dim');

  return commits.map((commit, index) => {
    const lit = isLit(index);
    const entries = [
      ...(commit.mergedOmitted ? [{ kind: 'omitted' as const, count: commit.mergedOmitted }] : []),
      ...(commit.merged ?? []).map((mergedCommit) => ({
        kind: 'commit' as const,
        commit: mergedCommit,
      })),
    ];
    const merged = entries.map(
      (entry, position): CommitGraphMergedRow => ({
        ...entry,
        cell: {
          above: stroke(lit),
          below: stroke(lit),
          dot: entry.kind === 'commit' ? { lane: 1, lit } : null,
          branch: { shape: position === 0 ? 'fork' : 'through', lit },
        },
      }),
    );

    return {
      commit,
      cell: {
        above: stroke(lit),
        below: index < commits.length - 1 ? stroke(isLit(index + 1)) : null,
        dot: { lane: 0, lit },
        branch: merged.length > 0 ? { shape: 'join', lit } : null,
      },
      merged,
    };
  });
}
