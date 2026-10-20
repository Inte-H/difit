import type { DiffCommentThread, ReviewDecision, ReviewScope, ThreadFixup } from '../types/diff.js';

import { isSameCommit } from './diffSelection.js';
import { selectOpenThreads } from './reviewDecisions.js';

// Keyed by the sha of each commit of the list, merged ones included; a thread with no fixup target
// counts toward the review's target commit.
export function countOpenThreadsByCommit(
  threads: Pick<DiffCommentThread, 'id' | 'messages' | 'fixupTarget'>[],
  fixupsByThread: ReadonlyMap<string, ThreadFixup[]>,
  decisions: ReviewDecision[],
  review: Pick<ReviewScope, 'selection' | 'commits'>,
): Map<string, number> {
  const shas = review.commits.flatMap((commit) => [
    commit.sha,
    ...(commit.merged ?? []).map(({ sha }) => sha),
  ]);
  const counts = new Map<string, number>();
  for (const thread of selectOpenThreads(threads, fixupsByThread, decisions)) {
    const fixupTarget = thread.fixupTarget ?? review.selection.targetCommitish;
    const sha = shas.find((candidate) => isSameCommit(candidate, fixupTarget));
    if (sha !== undefined) counts.set(sha, (counts.get(sha) ?? 0) + 1);
  }
  return counts;
}
