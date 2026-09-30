import { createContext, useContext, type ReactNode } from 'react';

import type {
  CommentThread,
  DirectEditRequest,
  ReviewDecision,
  ReviewDecisionKind,
  ThreadFixup,
  ThreadReviewState,
} from '../../types/diff';
import {
  deriveThreadReviewState,
  isOpenedByEdit,
  pendingFixupFor,
} from '../../utils/reviewDecisions';
import { type EditRange, rangeOfLine, rangesOverlap } from '../utils/directEdit';

export interface DirectEditFailure {
  message: string;
  output?: string;
}

export interface DirectEditControls {
  // Resolves to null once the fixup commit is made.
  submit: (request: DirectEditRequest) => Promise<DirectEditFailure | null>;
}

export interface FixupOverlayState {
  enabled: boolean;
  fixupsByThread: Map<string, ThreadFixup[]>;
  decisions: ReviewDecision[];
  // The commit being reviewed; null when the target is a working tree, the index or stdin.
  targetCommit: string | null;
  recordDecision: (threadId: string, kind: ReviewDecisionKind, fixupSha: string) => void;
  undoApproval: (threadId: string) => void;
  openReviewAt: (commit: string) => void;
  // Null when this review cannot take edits.
  directEdit: DirectEditControls | null;
}

export const EMPTY_FIXUP_OVERLAY: FixupOverlayState = {
  enabled: false,
  fixupsByThread: new Map(),
  decisions: [],
  targetCommit: null,
  recordDecision: () => {},
  undoApproval: () => {},
  openReviewAt: () => {},
  directEdit: null,
};

const FixupOverlayContext = createContext<FixupOverlayState>(EMPTY_FIXUP_OVERLAY);

export function FixupOverlayProvider({
  value,
  children,
}: {
  value: FixupOverlayState;
  children: ReactNode;
}) {
  return <FixupOverlayContext.Provider value={value}>{children}</FixupOverlayContext.Provider>;
}

export function useFixupOverlay(): FixupOverlayState {
  return useContext(FixupOverlayContext);
}

export interface ThreadReviewControls {
  state: ThreadReviewState;
  fixupSha: string | null;
  targetCommit: string | null;
  onDecide: (threadId: string, kind: ReviewDecisionKind, fixupSha: string) => void;
  onUndoApproval: (threadId: string) => void;
  onOpenReviewAt: (commit: string) => void;
}

export function recordWithPatchId(
  record: (threadId: string, kind: ReviewDecisionKind, fixupSha: string, patchId?: string) => void,
  fixupsByThread: ReadonlyMap<string, ThreadFixup[]>,
): FixupOverlayState['recordDecision'] {
  return (threadId, kind, fixupSha) =>
    record(
      threadId,
      kind,
      fixupSha,
      fixupsByThread.get(threadId)?.find((fixup) => fixup.sha === fixupSha)?.patchId,
    );
}

export function threadReviewControls(
  overlay: FixupOverlayState,
  thread: CommentThread,
): ThreadReviewControls | undefined {
  if (overlay.targetCommit === null) return undefined;
  const fixups = overlay.fixupsByThread.get(thread.id) ?? [];
  return {
    state: deriveThreadReviewState(thread.id, fixups, overlay.decisions, isOpenedByEdit(thread)),
    fixupSha: pendingFixupFor(thread.id, fixups, overlay.decisions)?.sha ?? null,
    targetCommit: overlay.targetCommit,
    onDecide: overlay.recordDecision,
    onUndoApproval: overlay.undoApproval,
    onOpenReviewAt: overlay.openReviewAt,
  };
}

export function canAnswerByEdit(overlay: FixupOverlayState, thread: CommentThread): boolean {
  if (!overlay.directEdit || (thread.side ?? 'new') !== 'new' || thread.isOutdated) return false;
  if (isOpenedByEdit(thread)) return false;
  const state = threadReviewControls(overlay, thread)?.state;
  return state === 'awaiting-fix' || state === 'rejected';
}

export function threadAnsweredByEdit(
  overlay: FixupOverlayState,
  threads: CommentThread[],
  range: EditRange,
): string | undefined {
  const answerable = threads.filter(
    (thread) => canAnswerByEdit(overlay, thread) && rangesOverlap(rangeOfLine(thread.line), range),
  );
  return answerable.length === 1 ? answerable[0]?.id : undefined;
}

// An outdated thread has no trustworthy line to draw under, so it gets no overlay.
export function overlaidFixup(
  overlay: FixupOverlayState,
  thread: CommentThread,
): ThreadFixup | null {
  if (!overlay.enabled || thread.isOutdated) return null;
  const fixups = overlay.fixupsByThread.get(thread.id) ?? [];
  const state = deriveThreadReviewState(thread.id, fixups, overlay.decisions);
  if (state !== 'awaiting-approval' && state !== 'approved') return null;
  return pendingFixupFor(thread.id, fixups, overlay.decisions) ?? null;
}
