import type { ReviewDecision, ThreadFixup, ThreadReviewState } from '../types/diff.js';

const REVIEW_DECISION_KINDS: ReviewDecision['kind'][] = ['rejected', 'approved', 'folded'];

const decisionKey = (decision: ReviewDecision) =>
  `${decision.threadId}|${decision.kind}|${decision.fixupSha}`;

export function mergeReviewDecisions(
  current: ReviewDecision[],
  incoming: ReviewDecision[],
): ReviewDecision[] {
  const byKey = new Map<string, ReviewDecision>();
  for (const decision of [...current, ...incoming]) {
    byKey.set(decisionKey(decision), decision);
  }
  return [...byKey.values()].sort((a, b) => a.at.localeCompare(b.at));
}

export function normalizeReviewDecisions(value: unknown): ReviewDecision[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is ReviewDecision => {
    if (typeof item !== 'object' || item === null) return false;
    const candidate = item as Partial<ReviewDecision>;
    return (
      typeof candidate.threadId === 'string' &&
      REVIEW_DECISION_KINDS.includes(candidate.kind as ReviewDecision['kind']) &&
      typeof candidate.fixupSha === 'string' &&
      typeof candidate.at === 'string'
    );
  });
}

function rejectedShasFor(threadId: string, decisions: ReviewDecision[]): Set<string> {
  return new Set(
    decisions
      .filter((decision) => decision.threadId === threadId && decision.kind === 'rejected')
      .map((decision) => decision.fixupSha),
  );
}

export function deriveThreadReviewState(
  threadId: string,
  fixups: ThreadFixup[],
  decisions: ReviewDecision[],
): ThreadReviewState {
  const own = decisions.filter((decision) => decision.threadId === threadId);
  if (own.some((decision) => decision.kind === 'folded')) return 'folded';
  if (own.some((decision) => decision.kind === 'approved')) return 'approved';

  const rejectedShas = rejectedShasFor(threadId, decisions);
  if (fixups.some((fixup) => !rejectedShas.has(fixup.sha))) return 'awaiting-approval';
  return rejectedShas.size > 0 ? 'rejected' : 'awaiting-fix';
}

// The fixup under judgment: the one not yet rejected, when there is exactly one.
export function pendingFixupFor(
  threadId: string,
  fixups: ThreadFixup[],
  decisions: ReviewDecision[],
): ThreadFixup | null {
  const rejectedShas = rejectedShasFor(threadId, decisions);
  const pending = fixups.filter((fixup) => !rejectedShas.has(fixup.sha));
  return pending.length === 1 ? (pending[0] ?? null) : null;
}
