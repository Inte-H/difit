import type {
  AnchorStaleReason,
  DiffCommentThread,
  DiffLineRange,
  DiffFile,
  DiffSelection,
  LineNumber,
  ReviewScope,
} from '../../types/diff';
import { noVisibleLineContradictsAnchor, relocateAnchor } from '../../utils/anchorRelocation';
import { extraLinesOfPosition, lineOfPosition, lineOfRange } from '../../utils/commentPosition';
import { commitsOfView, isSameCommit, isSameView } from '../../utils/diffSelection';

export interface FileLineIndex {
  old: Map<number, string>;
  new: Map<number, string>;
}

export interface ThreadPlacement {
  // Absent for a thread on the whole file.
  line?: LineNumber;
  extraLines?: LineNumber[];
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

// A stale thread keeps its stored position; one stale range makes the whole thread stale. Without a
// target commit (working tree, index, stdin) the thread is never moved, only checked at its stored
// lines.
export function locateThread(
  thread: DiffCommentThread,
  index: FileLineIndex | undefined,
  targetCommit: string | null,
  madeOnThisView?: boolean,
): ThreadPlacement {
  const { position } = thread;
  if (!('line' in position)) {
    return index ? { isOutdated: false } : { isOutdated: true, outdatedReason: 'missing' };
  }
  const extraRanges = position.extraRanges ?? [];
  const stored = atLines(position.line, extraRanges);
  const snapshot = thread.codeSnapshot?.content;
  if (snapshot === undefined) return { ...stored, isOutdated: false };
  if (!index) return { ...stored, isOutdated: true, outdatedReason: 'missing' };

  const extraContents = thread.codeSnapshot?.extraContents ?? [];
  // A range saved without its code stays where it was stored.
  const anchors: Array<{ line: DiffLineRange; content?: string }> = [
    ...extraRanges.map((line, i) => ({ line, content: extraContents[i] })),
    { line: position.line, content: snapshot },
  ];
  const lines = position.side === 'old' ? index.old : index.new;
  if (targetCommit === null) {
    const contradicted = anchors.some(
      ({ line, content }) =>
        content !== undefined && !noVisibleLineContradictsAnchor({ line, content }, lines),
    );
    return contradicted
      ? { ...stored, isOutdated: true, outdatedReason: 'missing' }
      : { ...stored, isOutdated: false };
  }

  // Storage and the server session are keyed by the target, so a thread without its commit was
  // made on this one.
  const anchorCommit = thread.codeSnapshot?.commit;
  const atAnchorCommit =
    madeOnThisView ?? (anchorCommit === undefined || isSameCommit(anchorCommit, targetCommit));
  const located: DiffLineRange[] = [];
  for (const { line, content } of anchors) {
    if (content === undefined) {
      located.push(line);
      continue;
    }
    const relocation = relocateAnchor({ line, content }, lines, atAnchorCommit);
    if (relocation.kind === 'stale') {
      return { ...stored, isOutdated: true, outdatedReason: relocation.reason };
    }
    located.push(relocation.line);
  }
  const line = located.pop() ?? position.line;
  return { ...atLines(line, located), isOutdated: false };
}

function atLines(line: DiffLineRange, extraRanges: readonly DiffLineRange[]) {
  return {
    line: lineOfRange(line),
    ...(extraRanges.length > 0 ? { extraLines: extraRanges.map(lineOfRange) } : {}),
  };
}

type PlacedLines = Pick<ThreadPlacement, 'line' | 'extraLines'>;

export type Placement =
  | ({ kind: 'stored' | 'moved' } & PlacedLines)
  | ({ kind: 'stale'; reason: AnchorStaleReason } & PlacedLines)
  | ({ kind: 'hidden' } & PlacedLines);

export interface PlacementContext {
  view: DiffSelection | null;
  review?: Pick<ReviewScope, 'selection' | 'commits'>;
  targetCommit: string | null;
}

const sameLines = (a: PlacedLines, b: PlacedLines) =>
  String(a.line) === String(b.line) && String(a.extraLines) === String(b.extraLines);
const placedLines = ({ line, extraLines }: PlacedLines): PlacedLines => ({
  ...(line === undefined ? {} : { line }),
  ...(extraLines === undefined ? {} : { extraLines }),
});

export function placeThread(
  thread: DiffCommentThread,
  { view, review, targetCommit }: PlacementContext,
  index: FileLineIndex | undefined,
  indexCommit?: string,
): Placement {
  const stored: PlacedLines = {
    line: lineOfPosition(thread.position),
    extraLines: extraLinesOfPosition(thread.position),
  };
  let madeOnThisView: boolean | undefined;
  if (view && review) {
    const fixupTarget = thread.fixupTarget ?? review.selection.targetCommitish;
    if (
      !isSameView(view, review.selection) &&
      !commitsOfView(view, review).some((commit) => isSameCommit(commit.sha, fixupTarget))
    ) {
      return { kind: 'hidden', ...placedLines(stored) };
    }
    const anchorCommit = thread.codeSnapshot?.commit;
    madeOnThisView =
      isSameView(thread.view ?? review.selection, view) &&
      (anchorCommit === undefined ||
        isSameCommit(anchorCommit, indexCommit ?? view.targetCommitish));
  }

  const placement = locateThread(thread, index, targetCommit, madeOnThisView);
  if (placement.isOutdated) {
    return {
      kind: 'stale',
      reason: placement.outdatedReason ?? 'missing',
      ...placedLines(placement),
    };
  }
  return {
    kind: sameLines(placement, stored) ? 'stored' : 'moved',
    ...placedLines(placement),
  };
}
