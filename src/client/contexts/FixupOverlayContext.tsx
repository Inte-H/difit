import { createContext, useContext, type ReactNode } from 'react';

import type {
  CommentThread,
  DiffSelection,
  DirectEditRequest,
  ReviewDecision,
  ReviewDecisionKind,
  ThreadFixup,
  ThreadReviewState,
} from '../../types/diff';
import {
  deriveThreadReviewState,
  isAgentResponding,
  isAnswerableByEdit,
  isOpenedByEdit,
  isThreadResolved,
  pendingFixupFor,
} from '../../utils/reviewDecisions';
import { type EditRange, rangeOfLine, rangesOverlap } from '../utils/directEdit';
import type { FixupBox, FixupFilePlace, FixupFileRef } from '../utils/fixupSpread';

export interface DirectEditFailure {
  message: string;
  output?: string;
}

export interface DirectEditControls {
  // The commit whose version of the file the edited lines come from.
  commit: string;
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
  showView: (view: DiffSelection) => void;
  // Null when this review cannot take edits.
  directEdit: DirectEditControls | null;
  // Keyed by the reviewed path, then by anchor; empty unless the whole review is shown.
  boxesByFile: ReadonlyMap<string, ReadonlyMap<number, FixupBox[]>>;
  // Keyed by fixupFileKey; empty unless the whole review is shown.
  fixupPlaces: ReadonlyMap<string, FixupFilePlace>;
  // Keyed by fixupFileKey; the path of the reviewed file each fixup file changes.
  fixupReviewPaths: ReadonlyMap<string, string>;
  focusedFixupFile: FixupFileRef | null;
  revealFixupFile: (fixupSha: string, path: string) => void;
  pickThread: (threadId: string) => void;
}

export const EMPTY_FIXUP_OVERLAY: FixupOverlayState = {
  enabled: false,
  fixupsByThread: new Map(),
  decisions: [],
  targetCommit: null,
  recordDecision: () => {},
  undoApproval: () => {},
  openReviewAt: () => {},
  showView: () => {},
  directEdit: null,
  boxesByFile: new Map(),
  fixupPlaces: new Map(),
  fixupReviewPaths: new Map(),
  focusedFixupFile: null,
  revealFixupFile: () => {},
  pickThread: () => {},
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
  responding: boolean;
  onDecide: (threadId: string, kind: ReviewDecisionKind, fixupSha: string) => void;
  onUndoApproval: (threadId: string) => void;
  onOpenReviewAt: (commit: string) => void;
  onShowView: (view: DiffSelection) => void;
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
    state: deriveThreadReviewState(thread.id, fixups, overlay.decisions, thread),
    fixupSha: pendingFixupFor(thread.id, fixups, overlay.decisions)?.sha ?? null,
    targetCommit: overlay.targetCommit,
    responding: isAgentResponding(thread, overlay.fixupsByThread, overlay.decisions),
    onDecide: overlay.recordDecision,
    onUndoApproval: overlay.undoApproval,
    onOpenReviewAt: overlay.openReviewAt,
    onShowView: overlay.showView,
  };
}

export function canAnswerByEdit(overlay: FixupOverlayState, thread: CommentThread): boolean {
  if (!overlay.directEdit || (thread.side ?? 'new') !== 'new' || thread.isOutdated) return false;
  if (isOpenedByEdit(thread) || isThreadResolved(thread.id, overlay.decisions)) return false;
  const state = threadReviewControls(overlay, thread)?.state;
  return state !== undefined && isAnswerableByEdit(state);
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
