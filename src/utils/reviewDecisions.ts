import type { ReviewDecision, ThreadFixup, ThreadReviewState } from '../types/diff.js';

const REVIEW_DECISION_KINDS: ReviewDecision['kind'][] = [
  'rejected',
  'approved',
  'unapproved',
  'folded',
];

const REVIEW_STATE_LABEL: Record<ThreadReviewState, string> = {
  'awaiting-fix': '수정 중',
  'awaiting-approval': '승인 대기',
  approved: '승인됨',
  folded: '접힘',
  rejected: '다시 수정 중',
};

export function reviewStateLabel(state: ThreadReviewState): string {
  return REVIEW_STATE_LABEL[state];
}

// Timestamps come from different writers and formats, so they are compared as instants.
const decidedAt = (decision: ReviewDecision) => Date.parse(decision.at) || 0;

const decisionKey = (decision: ReviewDecision) =>
  `${decision.threadId}|${decision.kind}|${decision.fixupSha}`;

export function mergeReviewDecisions(
  current: ReviewDecision[],
  incoming: ReviewDecision[],
): ReviewDecision[] {
  const byKey = new Map<string, ReviewDecision>();
  for (const decision of [...current, ...incoming]) {
    const key = decisionKey(decision);
    const kept = byKey.get(key);
    if (!kept || decidedAt(kept) <= decidedAt(decision)) byKey.set(key, decision);
  }
  return [...byKey.values()].sort((a, b) => decidedAt(a) - decidedAt(b));
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

function matcherFor(decisions: ReviewDecision[]): (fixup: ThreadFixup) => boolean {
  const shas = new Set(decisions.map((decision) => decision.fixupSha));
  const patchIds = new Set(decisions.flatMap((decision) => decision.patchId ?? []));
  return (fixup) => shas.has(fixup.sha) || patchIds.has(fixup.patchId);
}

function rejectionCheckFor(
  threadId: string,
  decisions: ReviewDecision[],
): (fixup: ThreadFixup) => boolean {
  return matcherFor(
    decisions.filter((decision) => decision.threadId === threadId && decision.kind === 'rejected'),
  );
}

function latestApprovalOrUndo(own: ReviewDecision[]): ReviewDecision | undefined {
  return own
    .filter((decision) => decision.kind === 'approved' || decision.kind === 'unapproved')
    .reduce<ReviewDecision | undefined>(
      (latest, decision) => (latest && decidedAt(latest) > decidedAt(decision) ? latest : decision),
      undefined,
    );
}

export function deriveThreadReviewState(
  threadId: string,
  fixups: ThreadFixup[],
  decisions: ReviewDecision[],
): ThreadReviewState {
  const own = decisions.filter((decision) => decision.threadId === threadId);
  if (own.some((decision) => decision.kind === 'folded')) return 'folded';

  const isRejected = rejectionCheckFor(threadId, decisions);
  const unrejected = fixups.filter((fixup) => !isRejected(fixup));
  const approval = latestApprovalOrUndo(own);
  // With no fixup left, the approved one is being folded and the fold record has not landed yet.
  if (approval?.kind === 'approved' && unrejected.every(matcherFor([approval]))) return 'approved';
  if (unrejected.length > 0) return 'awaiting-approval';
  return own.some((decision) => decision.kind === 'rejected') ? 'rejected' : 'awaiting-fix';
}

// Threads the agent still owes an answer: nothing to judge yet, or the last answer was rejected.
export function selectOpenThreads<T extends { id: string }>(
  threads: T[],
  fixupsByThread: ReadonlyMap<string, ThreadFixup[]>,
  decisions: ReviewDecision[],
): T[] {
  return threads.filter((thread) => {
    const state = deriveThreadReviewState(
      thread.id,
      fixupsByThread.get(thread.id) ?? [],
      decisions,
    );
    return state === 'awaiting-fix' || state === 'rejected';
  });
}

// The fixup under judgment: the one not yet rejected, when there is exactly one.
export function pendingFixupFor(
  threadId: string,
  fixups: ThreadFixup[],
  decisions: ReviewDecision[],
): ThreadFixup | null {
  const isRejected = rejectionCheckFor(threadId, decisions);
  const pending = fixups.filter((fixup) => !isRejected(fixup));
  return pending.length === 1 ? (pending[0] ?? null) : null;
}
