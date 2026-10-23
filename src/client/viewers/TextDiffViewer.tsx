import React, { useMemo, useState } from 'react';

import type { CommentThread, DiffLine } from '../../types/diff';
import { LEAVES_CODE_ALONE_LABEL, leavesCodeAlone } from '../../utils/changeKind';
import { DiffChunk } from '../components/DiffChunk';
import { ExpandButton } from '../components/ExpandButton';
import type { FoldedLines } from '../components/FoldedLines';
import type { CursorPosition } from '../hooks/keyboardNavigation';

import type { DiffViewerBodyProps } from './types';

function holdsThread(lines: DiffLine[], threads: CommentThread[]) {
  return threads.some((thread) => {
    const end = Array.isArray(thread.line) ? thread.line[1] : thread.line;
    return lines.some(
      (line) =>
        (thread.side !== 'new' && line.oldLineNumber === end) ||
        (thread.side !== 'old' && line.newLineNumber === end),
    );
  });
}

const sameCursor = (a: CursorPosition, b: CursorPosition | null | undefined) =>
  !!b &&
  a.fileIndex === b.fileIndex &&
  a.chunkIndex === b.chunkIndex &&
  a.lineIndex === b.lineIndex &&
  a.side === b.side;

type FoldEntry = FoldedLines & { originalIndex: number };
const NO_FOLD_ENTRIES: readonly FoldEntry[] = [];

// A block of consecutive changes counts its larger side, so one edited line is one line.
function changedLineCount(lines: DiffLine[]) {
  let total = 0;
  let adds = 0;
  let deletes = 0;
  for (const line of lines) {
    if (line.type === 'add') adds += 1;
    else if (line.type === 'delete') deletes += 1;
    else {
      total += Math.max(adds, deletes);
      adds = 0;
      deletes = 0;
    }
  }
  return total + Math.max(adds, deletes);
}

export function TextDiffViewer({
  file,
  threads,
  showAuthorBadges,
  diffMode,
  syntaxTheme,
  cursor,
  fileIndex,
  mergedChunks,
  foldCommentChanges = false,
  isExpandLoading,
  expandHiddenLines,
  expandAllBetweenChunks,
  onAddComment,
  onResolveThread,
  onReplyToThread,
  onRemoveMessage,
  onUpdateMessage,
  onLineClick,
  onOpenInEditor,
  commentTrigger,
  onCommentTriggerHandled,
}: DiffViewerBodyProps) {
  const [unfolded, setUnfolded] = useState<ReadonlySet<number>>(new Set());
  // A part folded with the cursor inside stays folded until the cursor moves.
  const [foldedUnderCursor, setFoldedUnderCursor] = useState<{
    originalIndex: number;
    cursor: CursorPosition;
  } | null>(null);
  if (!foldCommentChanges && unfolded.size > 0) {
    setUnfolded(new Set());
  }
  if (foldedUnderCursor && (!foldCommentChanges || !sameCursor(foldedUnderCursor.cursor, cursor))) {
    setFoldedUnderCursor(null);
  }

  const renderExpandButton = (
    position: 'top' | 'middle' | 'bottom',
    mergedChunk: (typeof mergedChunks)[number],
    firstOriginalIndex: number,
    lastOriginalIndex: number,
  ) => {
    if (position === 'top' && mergedChunk.hiddenLinesBefore > 0) {
      return (
        <ExpandButton
          direction="down"
          hiddenLines={mergedChunk.hiddenLinesBefore}
          onExpandDown={() => expandHiddenLines(file, firstOriginalIndex, 'up')}
          onExpandAll={() =>
            expandAllBetweenChunks(file, firstOriginalIndex, mergedChunk.hiddenLinesBefore)
          }
          isLoading={isExpandLoading}
        />
      );
    }

    if (position === 'middle' && mergedChunk.hiddenLinesBefore > 0) {
      return (
        <ExpandButton
          direction="both"
          hiddenLines={mergedChunk.hiddenLinesBefore}
          onExpandUp={() => expandHiddenLines(file, firstOriginalIndex - 1, 'down')}
          onExpandDown={() => expandHiddenLines(file, firstOriginalIndex, 'up')}
          onExpandAll={() =>
            expandAllBetweenChunks(file, firstOriginalIndex, mergedChunk.hiddenLinesBefore)
          }
          isLoading={isExpandLoading}
        />
      );
    }

    if (position === 'bottom' && mergedChunk.hiddenLinesAfter > 0) {
      return (
        <ExpandButton
          direction="up"
          hiddenLines={mergedChunk.hiddenLinesAfter}
          onExpandUp={() => expandHiddenLines(file, lastOriginalIndex, 'down')}
          onExpandAll={() =>
            expandHiddenLines(file, lastOriginalIndex, 'down', mergedChunk.hiddenLinesAfter)
          }
          isLoading={isExpandLoading}
        />
      );
    }

    return null;
  };

  const foldsByChunk = useMemo(
    () =>
      mergedChunks.map((mergedChunk): readonly FoldEntry[] => {
        if (!foldCommentChanges) return NO_FOLD_ENTRIES;
        const folds = mergedChunk.originalLineRanges.flatMap(
          ({ originalIndex, start, end, changeKind }) => {
            const lines = mergedChunk.lines.slice(start, end + 1);
            if (!leavesCodeAlone(changeKind) || holdsThread(lines, threads)) {
              return [];
            }
            const folded = !unfolded.has(originalIndex);
            return [
              {
                originalIndex,
                start,
                end,
                summary: `${LEAVES_CODE_ALONE_LABEL[changeKind]} ${changedLineCount(lines)}줄 바뀜`,
                folded,
                onToggle: () =>
                  setUnfolded((prev) => {
                    const next = new Set(prev);
                    if (folded) next.add(originalIndex);
                    else next.delete(originalIndex);
                    return next;
                  }),
              },
            ];
          },
        );
        return folds.length > 0 ? folds : NO_FOLD_ENTRIES;
      }),
    [mergedChunks, foldCommentChanges, unfolded, threads],
  );

  const shownFolds = useMemo(
    () =>
      foldsByChunk.map((folds, mergedIndex): readonly FoldedLines[] => {
        if (!cursor || cursor.chunkIndex !== mergedIndex) return folds;
        const holds = (fold: FoldEntry) =>
          foldedUnderCursor?.originalIndex !== fold.originalIndex &&
          cursor.lineIndex >= fold.start &&
          cursor.lineIndex <= fold.end;
        if (!folds.some(holds)) return folds;
        return folds.map((fold) =>
          holds(fold)
            ? {
                ...fold,
                folded: false,
                onToggle: () => {
                  setUnfolded((prev) => {
                    const next = new Set(prev);
                    next.delete(fold.originalIndex);
                    return next;
                  });
                  setFoldedUnderCursor({ originalIndex: fold.originalIndex, cursor });
                },
              }
            : fold,
        );
      }),
    [foldsByChunk, cursor, foldedUnderCursor],
  );

  return (
    <>
      {mergedChunks.map((mergedChunk, mergedIndex) => {
        const isFirstMerged = mergedIndex === 0;
        const isLastMerged = mergedIndex === mergedChunks.length - 1;
        const firstOriginalIndex = mergedChunk.originalIndices[0] ?? 0;
        const lastOriginalIndex =
          mergedChunk.originalIndices[mergedChunk.originalIndices.length - 1] ?? 0;
        const folds = shownFolds[mergedIndex] ?? NO_FOLD_ENTRIES;

        return (
          <React.Fragment key={mergedIndex}>
            {isFirstMerged &&
              renderExpandButton('top', mergedChunk, firstOriginalIndex, lastOriginalIndex)}

            {!isFirstMerged &&
              renderExpandButton('middle', mergedChunk, firstOriginalIndex, lastOriginalIndex)}

            <div id={`chunk-${file.path.replace(/[^a-zA-Z0-9]/g, '-')}-${mergedIndex}`}>
              <DiffChunk
                chunk={mergedChunk}
                chunkIndex={mergedIndex}
                threads={threads}
                showAuthorBadges={showAuthorBadges}
                onAddComment={onAddComment}
                onResolveThread={onResolveThread}
                onReplyToThread={onReplyToThread}
                onRemoveMessage={onRemoveMessage}
                onUpdateMessage={onUpdateMessage}
                onOpenInEditor={onOpenInEditor}
                mode={diffMode}
                syntaxTheme={syntaxTheme}
                cursor={cursor && cursor.chunkIndex === mergedIndex ? cursor : null}
                fileIndex={fileIndex}
                onLineClick={onLineClick}
                commentTrigger={
                  commentTrigger && commentTrigger.chunkIndex === mergedIndex
                    ? commentTrigger
                    : null
                }
                onCommentTriggerHandled={onCommentTriggerHandled}
                filename={file.path}
                foldedLines={folds}
              />
            </div>

            {isLastMerged &&
              renderExpandButton('bottom', mergedChunk, firstOriginalIndex, lastOriginalIndex)}
          </React.Fragment>
        );
      })}
    </>
  );
}
