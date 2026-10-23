import React, { useMemo, useState } from 'react';

import type { CommentThread, DiffLine } from '../../types/diff';
import { LEAVES_CODE_ALONE_LABEL, leavesCodeAlone } from '../../utils/changeKind';
import { DiffChunk } from '../components/DiffChunk';
import { ExpandButton } from '../components/ExpandButton';
import { type FoldedLines, NO_FOLDS } from '../components/FoldedLines';

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
  if (!foldCommentChanges && unfolded.size > 0) {
    setUnfolded(new Set());
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
      mergedChunks.map((mergedChunk): readonly FoldedLines[] => {
        if (!foldCommentChanges) return NO_FOLDS;
        const folds = mergedChunk.originalLineRanges.flatMap(
          ({ originalIndex, start, end, changeKind }) => {
            const lines = mergedChunk.lines.slice(start, end + 1);
            if (
              !leavesCodeAlone(changeKind) ||
              unfolded.has(originalIndex) ||
              holdsThread(lines, threads)
            ) {
              return [];
            }
            return [
              {
                start,
                end,
                label: `${LEAVES_CODE_ALONE_LABEL[changeKind]} ${changedLineCount(lines)}줄 바뀜 · 펼치기`,
                onUnfold: () => setUnfolded((prev) => new Set(prev).add(originalIndex)),
              },
            ];
          },
        );
        return folds.length > 0 ? folds : NO_FOLDS;
      }),
    [mergedChunks, foldCommentChanges, unfolded, threads],
  );

  const foldsAt = (mergedIndex: number) => {
    const folds = foldsByChunk[mergedIndex] ?? NO_FOLDS;
    const lineIndexHere = (
      position: { chunkIndex: number; lineIndex: number } | null | undefined,
    ) => (position?.chunkIndex === mergedIndex ? position.lineIndex : null);
    const held = [lineIndexHere(cursor), lineIndexHere(commentTrigger)].filter(
      (lineIndex) => lineIndex !== null,
    );
    if (held.length === 0) return folds;
    const open = folds.filter(
      (fold) => !held.some((lineIndex) => lineIndex >= fold.start && lineIndex <= fold.end),
    );
    if (open.length === folds.length) return folds;
    return open.length > 0 ? open : NO_FOLDS;
  };

  return (
    <>
      {mergedChunks.map((mergedChunk, mergedIndex) => {
        const isFirstMerged = mergedIndex === 0;
        const isLastMerged = mergedIndex === mergedChunks.length - 1;
        const firstOriginalIndex = mergedChunk.originalIndices[0] ?? 0;
        const lastOriginalIndex =
          mergedChunk.originalIndices[mergedChunk.originalIndices.length - 1] ?? 0;
        const folds = foldsAt(mergedIndex);

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
