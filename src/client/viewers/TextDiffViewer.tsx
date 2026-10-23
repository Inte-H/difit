import React, { useState } from 'react';

import type { CommentThread, DiffChunk as DiffChunkData } from '../../types/diff';
import { LEAVES_CODE_ALONE_LABEL, leavesCodeAlone } from '../../utils/changeKind';
import { DiffChunk } from '../components/DiffChunk';
import { ExpandButton } from '../components/ExpandButton';

import type { DiffViewerBodyProps } from './types';

function holdsThread(chunk: DiffChunkData, threads: CommentThread[]) {
  return threads.some((thread) => {
    const end = Array.isArray(thread.line) ? thread.line[1] : thread.line;
    return chunk.lines.some(
      (line) =>
        (thread.side !== 'new' && line.oldLineNumber === end) ||
        (thread.side !== 'old' && line.newLineNumber === end),
    );
  });
}

// A block of consecutive changes counts its larger side, so one edited line is one line.
function changedLineCount(chunk: DiffChunkData) {
  let total = 0;
  let adds = 0;
  let deletes = 0;
  for (const line of chunk.lines) {
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

  return (
    <>
      {mergedChunks.map((mergedChunk, mergedIndex) => {
        const isFirstMerged = mergedIndex === 0;
        const isLastMerged = mergedIndex === mergedChunks.length - 1;
        const firstOriginalIndex = mergedChunk.originalIndices[0] ?? 0;
        const lastOriginalIndex =
          mergedChunk.originalIndices[mergedChunk.originalIndices.length - 1] ?? 0;
        const { changeKind } = mergedChunk;
        const foldedKind =
          foldCommentChanges &&
          leavesCodeAlone(changeKind) &&
          !unfolded.has(firstOriginalIndex) &&
          cursor?.chunkIndex !== mergedIndex &&
          commentTrigger?.chunkIndex !== mergedIndex &&
          !holdsThread(mergedChunk, threads)
            ? changeKind
            : null;

        return (
          <React.Fragment key={mergedIndex}>
            {isFirstMerged &&
              renderExpandButton('top', mergedChunk, firstOriginalIndex, lastOriginalIndex)}

            {!isFirstMerged &&
              renderExpandButton('middle', mergedChunk, firstOriginalIndex, lastOriginalIndex)}

            <div id={`chunk-${file.path.replace(/[^a-zA-Z0-9]/g, '-')}-${mergedIndex}`}>
              {foldedKind ? (
                <button
                  type="button"
                  onClick={() => setUnfolded((prev) => new Set(prev).add(firstOriginalIndex))}
                  className="w-full px-3 py-1.5 text-left text-xs font-mono bg-github-bg-secondary text-github-text-secondary hover:text-github-text-primary hover:bg-github-bg-tertiary border-y border-github-border cursor-pointer"
                >
                  {LEAVES_CODE_ALONE_LABEL[foldedKind]} {changedLineCount(mergedChunk)}줄 바뀜 ·
                  펼치기
                </button>
              ) : (
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
                />
              )}
            </div>

            {isLastMerged &&
              renderExpandButton('bottom', mergedChunk, firstOriginalIndex, lastOriginalIndex)}
          </React.Fragment>
        );
      })}
    </>
  );
}
