import type {
  AnchorStaleReason,
  DiffCommentThread,
  DiffFile,
  DiffSelection,
  LineNumber,
  ReviewScope,
} from '../../types/diff';
import { noVisibleLineContradictsAnchor, relocateAnchor } from '../../utils/anchorRelocation';
import { commitsOfView, isSameCommit, isSameView } from '../../utils/diffSelection';

export interface FileLineIndex {
  old: Map<number, string>;
  new: Map<number, string>;
}

export interface ThreadPlacement {
  line: LineNumber;
  isOutdated: boolean;
  outdatedReason?: AnchorStaleReason;
}

export function buildFileLineIndex(file: Pick<DiffFile, 'chunks'>): FileLineIndex {
  const oldIndex = new Map<number, string>();
  const newIndex = new Map<number, string>();

  for (const chunk of file.chunks) {
    for (const line of chunk.lines) {
      if (line.oldLineNumber !== undefined) {
        oldIndex.set(line.oldLineNumber, line.content);
      }
      if (line.newLineNumber !== undefined) {
        newIndex.set(line.newLineNumber, line.content);
      }
    }
  }

  return { old: oldIndex, new: newIndex };
}

const toLineNumber = (line: DiffCommentThread['position']['line']): LineNumber =>
  typeof line === 'number' ? line : [line.start, line.end];

// A stale thread keeps its stored position. Without a target commit (working tree, index, stdin)
// the thread is never moved, only checked at its stored line.
export function locateThread(
  thread: DiffCommentThread,
  index: FileLineIndex | undefined,
  targetCommit: string | null,
  madeOnThisView?: boolean,
): ThreadPlacement {
  const storedLine = toLineNumber(thread.position.line);
  const snapshot = thread.codeSnapshot?.content;
  if (snapshot === undefined) return { line: storedLine, isOutdated: false };
  if (!index) return { line: storedLine, isOutdated: true, outdatedReason: 'missing' };

  const anchor = { line: thread.position.line, content: snapshot };
  const lines = thread.position.side === 'old' ? index.old : index.new;
  if (targetCommit === null) {
    return noVisibleLineContradictsAnchor(anchor, lines)
      ? { line: storedLine, isOutdated: false }
      : { line: storedLine, isOutdated: true, outdatedReason: 'missing' };
  }

  // Storage and the server session are keyed by the target, so a thread without its commit was
  // made on this one.
  const anchorCommit = thread.codeSnapshot?.commit;
  const relocation = relocateAnchor(
    anchor,
    lines,
    madeOnThisView ?? (anchorCommit === undefined || isSameCommit(anchorCommit, targetCommit)),
  );
  if (relocation.kind === 'stale') {
    return { line: storedLine, isOutdated: true, outdatedReason: relocation.reason };
  }
  return { line: toLineNumber(relocation.line), isOutdated: false };
}

export type Placement =
  | { kind: 'stored' | 'moved'; line: LineNumber }
  | { kind: 'stale'; reason: AnchorStaleReason; line: LineNumber }
  | { kind: 'hidden'; line: LineNumber };

export interface PlacementContext {
  view: DiffSelection | null;
  review?: Pick<ReviewScope, 'selection' | 'commits'>;
  targetCommit: string | null;
}

const sameLine = (a: LineNumber, b: LineNumber) => String(a) === String(b);

export function placeThread(
  thread: DiffCommentThread,
  { view, review, targetCommit }: PlacementContext,
  index: FileLineIndex | undefined,
  indexCommit?: string,
): Placement {
  const storedLine = toLineNumber(thread.position.line);
  let madeOnThisView: boolean | undefined;
  if (view && review) {
    const fixupTarget = thread.fixupTarget ?? review.selection.targetCommitish;
    if (
      !isSameView(view, review.selection) &&
      !commitsOfView(view, review).some((commit) => isSameCommit(commit.sha, fixupTarget))
    ) {
      return { kind: 'hidden', line: storedLine };
    }
    const anchorCommit = thread.codeSnapshot?.commit;
    madeOnThisView =
      isSameView(thread.view ?? review.selection, view) &&
      (anchorCommit === undefined ||
        isSameCommit(anchorCommit, indexCommit ?? view.targetCommitish));
  }

  const placement = locateThread(thread, index, targetCommit, madeOnThisView);
  if (placement.isOutdated) {
    return { kind: 'stale', reason: placement.outdatedReason ?? 'missing', line: placement.line };
  }
  return { kind: sameLine(placement.line, storedLine) ? 'stored' : 'moved', line: placement.line };
}
