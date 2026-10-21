import {
  REVIEWER_AUTHOR,
  REVIEWER_EDIT_AUTHOR,
  type DiffCommentThread,
  type ReviewDecision,
  type ThreadAwaitingAgent,
  type ThreadFixup,
  type ThreadReviewState,
} from '../types/diff.js';

const REVIEW_DECISION_KINDS: ReviewDecision['kind'][] = [
  'rejected',
  'approved',
  'unapproved',
  'folded',
  'resolved',
  'unresolved',
  'handed',
  'deleted',
];

const REVIEW_STATE_LABEL: Record<ThreadReviewState, string> = {
  'awaiting-fix': '수정 중',
  answered: '답변 완료',
  'awaiting-approval': '승인 대기',
  approved: '승인됨',
  folded: '접힘',
  rejected: '다시 수정 중',
  withdrawn: '되돌림',
  deleted: '지움',
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

const isOptionalString = (value: unknown) => value === undefined || typeof value === 'string';

function toReviewDecision(item: unknown): ReviewDecision | null {
  if (typeof item !== 'object' || item === null) return null;
  const { threadId, kind, fixupSha, patchId, targetSha, at } = item as Record<string, unknown>;
  if (
    typeof threadId !== 'string' ||
    !REVIEW_DECISION_KINDS.includes(kind as ReviewDecision['kind']) ||
    typeof fixupSha !== 'string' ||
    typeof at !== 'string' ||
    !isOptionalString(patchId) ||
    !isOptionalString(targetSha)
  ) {
    return null;
  }
  return {
    threadId,
    kind: kind as ReviewDecision['kind'],
    fixupSha,
    ...(patchId === undefined ? {} : { patchId: patchId as string }),
    ...(targetSha === undefined ? {} : { targetSha: targetSha as string }),
    at,
  };
}

export function normalizeReviewDecisions(value: unknown): ReviewDecision[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => toReviewDecision(item) ?? []);
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

function latestOf(
  own: ReviewDecision[],
  kinds: readonly ReviewDecision['kind'][],
): ReviewDecision | undefined {
  return own
    .filter((decision) => kinds.includes(decision.kind))
    .reduce<ReviewDecision | undefined>(
      (latest, decision) => (latest && decidedAt(latest) > decidedAt(decision) ? latest : decision),
      undefined,
    );
}

export function isThreadResolved(threadId: string, decisions: ReviewDecision[]): boolean {
  const own = decisions.filter((decision) => decision.threadId === threadId);
  return latestOf(own, ['resolved', 'unresolved'])?.kind === 'resolved';
}

type ThreadMessages = { messages?: ReadonlyArray<{ author?: string }> };

export function isThreadDeleted(threadId: string, decisions: ReviewDecision[]): boolean {
  return decisions.some(
    (decision) => decision.threadId === threadId && decision.kind === 'deleted',
  );
}

export function isOpenedByEdit(thread: ThreadMessages): boolean {
  return thread.messages?.[0]?.author === REVIEWER_EDIT_AUTHOR;
}

const isAgentMessage = (message: { author?: string }) =>
  message.author !== REVIEWER_AUTHOR && message.author !== REVIEWER_EDIT_AUTHOR;

export function deriveThreadReviewState(
  threadId: string,
  fixups: ThreadFixup[],
  decisions: ReviewDecision[],
  thread: ThreadMessages = {},
): ThreadReviewState {
  const own = decisions.filter((decision) => decision.threadId === threadId);
  if (own.some((decision) => decision.kind === 'folded')) return 'folded';
  if (own.some((decision) => decision.kind === 'deleted')) return 'deleted';

  const isRejected = rejectionCheckFor(threadId, decisions);
  const unrejected = fixups.filter((fixup) => !isRejected(fixup));
  const approval = latestOf(own, ['approved', 'unapproved']);
  const approvalStands =
    approval?.kind === 'approved' &&
    !own.some(
      (decision) =>
        decision.kind === 'rejected' &&
        decidedAt(decision) >= decidedAt(approval) &&
        (decision.fixupSha === approval.fixupSha ||
          (decision.patchId !== undefined && decision.patchId === approval.patchId)),
    );
  // With no fixup left, the approved one is being folded and the fold record has not landed yet.
  if (approvalStands && unrejected.every(matcherFor([approval]))) return 'approved';
  if (unrejected.length > 0) return 'awaiting-approval';
  if (!own.some((decision) => decision.kind === 'rejected')) {
    const messages = thread.messages ?? [];
    const last = messages.at(-1);
    const agentReplied =
      last !== undefined && isAgentMessage(last) && !messages.every(isAgentMessage);
    return agentReplied ? 'answered' : 'awaiting-fix';
  }
  return isOpenedByEdit(thread) ? 'withdrawn' : 'rejected';
}

// States with no fixup under judgment, where an edit in the viewer can still answer the thread.
export function isAnswerableByEdit(state: ThreadReviewState): boolean {
  return state === 'awaiting-fix' || state === 'answered' || state === 'rejected';
}

// Unresolved threads the agent still owes an answer: no answer yet, or the last answer was rejected.
export function selectOpenThreads<T extends { id: string } & ThreadMessages>(
  threads: T[],
  fixupsByThread: ReadonlyMap<string, ThreadFixup[]>,
  decisions: ReviewDecision[],
): T[] {
  return threads.filter((thread) => {
    if (isThreadResolved(thread.id, decisions)) return false;
    const state = deriveThreadReviewState(
      thread.id,
      fixupsByThread.get(thread.id) ?? [],
      decisions,
      thread,
    );
    return state === 'awaiting-fix' || state === 'rejected';
  });
}

// open: the agent's move. answered: the reviewer's move. resolved: nobody's.
export type CommentPanelStatus = 'open' | 'answered' | 'resolved';

const COMMENT_PANEL_STATUS: Record<ThreadReviewState, CommentPanelStatus | null> = {
  'awaiting-fix': 'open',
  rejected: 'open',
  answered: 'answered',
  'awaiting-approval': 'answered',
  approved: 'resolved',
  folded: 'resolved',
  withdrawn: 'resolved',
  deleted: null,
};

// Null for a deleted thread, which the comments panel never lists.
export function commentPanelStatus(
  thread: { id: string } & ThreadMessages,
  fixups: ThreadFixup[],
  decisions: ReviewDecision[],
): CommentPanelStatus | null {
  const status =
    COMMENT_PANEL_STATUS[deriveThreadReviewState(thread.id, fixups, decisions, thread)];
  if (status !== null && isThreadResolved(thread.id, decisions)) return 'resolved';
  return status;
}

type ThreadForAgent = Pick<
  DiffCommentThread,
  'id' | 'filePath' | 'position' | 'messages' | 'fixupTarget'
>;

type ThreadTurn = Pick<DiffCommentThread, 'id' | 'messages'>;

// A rejection stays the agent's turn until a new fixup lands, the rejected one is dropped
// (withdrawn only), or the agent has the last word after it.
function rejectionAwaitingAgent(
  thread: ThreadTurn,
  fixups: ThreadFixup[],
  decisions: ReviewDecision[],
  state: 'rejected' | 'withdrawn',
): string | undefined | null {
  const rejections = decisions.filter(
    (decision) => decision.threadId === thread.id && decision.kind === 'rejected',
  );
  const latest = rejections.reduce((a, b) => (decidedAt(a) >= decidedAt(b) ? a : b));
  const last = thread.messages.at(-1);
  if (last && isAgentMessage(last) && (Date.parse(last.createdAt) || 0) >= decidedAt(latest)) {
    return null;
  }
  const leftInRange = fixups.find(matcherFor(rejections))?.sha;
  if (state === 'withdrawn' && leftInRange === undefined) return null;
  return leftInRange;
}

// When the agent's current turn on the thread began: its last message, latest rejection or deletion.
function turnStartOf(thread: ThreadTurn, decisions: ReviewDecision[]): number {
  const own = decisions.filter((decision) => decision.threadId === thread.id);
  const restart = latestOf(own, ['rejected', 'deleted']);
  return Math.max(
    Date.parse(thread.messages.at(-1)?.createdAt ?? '') || 0,
    restart ? decidedAt(restart) : 0,
  );
}

// A deleted thread is the agent's turn while its fixup is still in the range, or once, to stop work
// it was handed and had not answered.
function deletionTurnOn(
  thread: ThreadTurn,
  fixupsByThread: ReadonlyMap<string, ThreadFixup[]> | undefined,
  decisions: ReviewDecision[],
  deletion: ReviewDecision,
): Pick<ThreadAwaitingAgent, 'state' | 'label' | 'rejectedFixupSha'> | null {
  const turn = { state: 'deleted' as const, label: reviewStateLabel('deleted') };
  const leftInRange = fixupsByThread?.get(thread.id)?.[0]?.sha;
  if (leftInRange !== undefined) return { ...turn, rejectedFixupSha: leftInRange };
  const own = decisions.filter((decision) => decision.threadId === thread.id);
  const handover = latestOf(own, ['handed']);
  if (!handover || decidedAt(handover) >= decidedAt(deletion)) return null;
  const turnBefore = turnStartOf(
    thread,
    own.filter((decision) => decision.kind !== 'deleted'),
  );
  return decidedAt(handover) >= turnBefore ? turn : null;
}

// The reviewer replied to the fixup under judgment: the last word is theirs and came after every
// fixup still standing was written.
function reviewerRepliedToFixup(
  thread: ThreadTurn,
  fixups: ThreadFixup[],
  decisions: ReviewDecision[],
): boolean {
  const last = thread.messages.at(-1);
  if (last?.author !== REVIEWER_AUTHOR) return false;
  const repliedAt = Date.parse(last.createdAt) || 0;
  const isRejected = rejectionCheckFor(thread.id, decisions);
  return fixups
    .filter((fixup) => !isRejected(fixup))
    .every((fixup) => repliedAt > (Date.parse(fixup.authoredAt) || 0));
}

function reviewerRepliedAfterApproval(thread: ThreadTurn, decisions: ReviewDecision[]): boolean {
  const last = thread.messages.at(-1);
  if (last?.author !== REVIEWER_AUTHOR) return false;
  const own = decisions.filter((decision) => decision.threadId === thread.id);
  const approval = latestOf(own, ['approved']);
  return approval !== undefined && (Date.parse(last.createdAt) || 0) > decidedAt(approval);
}

// The approved fixup is still in the range and the reviewer's reply came after it, whether before
// or after the approval.
function reviewerRepliedToApprovedFixup(
  thread: ThreadTurn,
  fixups: ThreadFixup[],
  decisions: ReviewDecision[],
): boolean {
  const isRejected = rejectionCheckFor(thread.id, decisions);
  return (
    fixups.some((fixup) => !isRejected(fixup)) && reviewerRepliedToFixup(thread, fixups, decisions)
  );
}

// Null when the next move on the thread is not the agent's. Without fixups (a review with no pinned
// commit) it is the agent's whenever the reviewer spoke last.
function agentTurnOn(
  thread: ThreadTurn,
  fixupsByThread: ReadonlyMap<string, ThreadFixup[]> | undefined,
  decisions: ReviewDecision[],
): Pick<ThreadAwaitingAgent, 'state' | 'label' | 'rejectedFixupSha'> | null {
  const deletion = latestOf(
    decisions.filter((decision) => decision.threadId === thread.id),
    ['deleted'],
  );
  if (deletion) return deletionTurnOn(thread, fixupsByThread, decisions, deletion);
  if (isThreadResolved(thread.id, decisions)) return null;
  const reviewerSpokeLast = thread.messages.at(-1)?.author === REVIEWER_AUTHOR;
  if (!fixupsByThread) return reviewerSpokeLast ? {} : null;

  const fixups = fixupsByThread.get(thread.id) ?? [];
  const state = deriveThreadReviewState(thread.id, fixups, decisions, thread);
  if (state === 'awaiting-fix') {
    return reviewerSpokeLast ? { state, label: reviewStateLabel(state) } : null;
  }
  if (state === 'awaiting-approval' || state === 'approved') {
    const replied =
      state === 'approved'
        ? reviewerRepliedAfterApproval(thread, decisions) ||
          reviewerRepliedToApprovedFixup(thread, fixups, decisions)
        : reviewerRepliedToFixup(thread, fixups, decisions);
    return replied ? { state, label: reviewStateLabel(state) } : null;
  }
  if (state !== 'rejected' && state !== 'withdrawn') return null;
  const rejectedFixupSha = rejectionAwaitingAgent(thread, fixups, decisions, state);
  if (rejectedFixupSha === null) return null;
  return {
    state,
    label: reviewStateLabel(state),
    ...(rejectedFixupSha === undefined ? {} : { rejectedFixupSha }),
  };
}

export function selectThreadsAwaitingAgent(
  threads: ThreadForAgent[],
  fixupsByThread: ReadonlyMap<string, ThreadFixup[]> | undefined,
  decisions: ReviewDecision[],
): ThreadAwaitingAgent[] {
  return threads.flatMap((thread): ThreadAwaitingAgent[] => {
    const turn = agentTurnOn(thread, fixupsByThread, decisions);
    if (!turn) return [];
    return [
      {
        threadId: thread.id,
        filePath: thread.filePath,
        position: thread.position,
        message: thread.messages.at(-1)?.body ?? '',
        ...(thread.fixupTarget === undefined ? {} : { fixupTarget: thread.fixupTarget }),
        ...turn,
      },
    ];
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

// Handed over since the agent's turn began, by the last message or rejection, and not answered yet.
export function isAgentResponding(
  thread: ThreadTurn,
  fixupsByThread: ReadonlyMap<string, ThreadFixup[]> | undefined,
  decisions: ReviewDecision[],
): boolean {
  const own = decisions.filter((decision) => decision.threadId === thread.id);
  const handover = latestOf(own, ['handed']);
  if (!handover) return false;
  if (!agentTurnOn(thread, fixupsByThread, decisions)) return false;
  return decidedAt(handover) >= turnStartOf(thread, own);
}
