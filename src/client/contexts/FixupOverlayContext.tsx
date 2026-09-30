import { createContext, useContext, type ReactNode } from 'react';

import type {
  CommentThread,
  ReviewDecision,
  ReviewDecisionKind,
  ThreadFixup,
  ThreadReviewState,
} from '../../types/diff';
import { deriveThreadReviewState, pendingFixupFor } from '../../utils/reviewDecisions';

export interface FixupOverlayState {
  enabled: boolean;
  fixupsByThread: Map<string, ThreadFixup[]>;
  decisions: ReviewDecision[];
  // The commit being reviewed; null when the target is a working tree, the index or stdin.
  targetCommit: string | null;
  recordDecision: (threadId: string, kind: ReviewDecisionKind, fixupSha: string) => void;
  undoApproval: (threadId: string) => void;
  openReviewAt: (commit: string) => void;
}

export const EMPTY_FIXUP_OVERLAY: FixupOverlayState = {
  enabled: false,
  fixupsByThread: new Map(),
  decisions: [],
  targetCommit: null,
  recordDecision: () => {},
  undoApproval: () => {},
  openReviewAt: () => {},
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
  threadId: string,
): ThreadReviewControls | undefined {
  if (overlay.targetCommit === null) return undefined;
  const fixups = overlay.fixupsByThread.get(threadId) ?? [];
  return {
    state: deriveThreadReviewState(threadId, fixups, overlay.decisions),
    fixupSha: pendingFixupFor(threadId, fixups, overlay.decisions)?.sha ?? null,
    targetCommit: overlay.targetCommit,
    onDecide: overlay.recordDecision,
    onUndoApproval: overlay.undoApproval,
    onOpenReviewAt: overlay.openReviewAt,
  };
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
