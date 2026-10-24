import React, { useState, useEffect, useCallback, useMemo, useRef, memo } from 'react';

import {
  type DiffChunk as DiffChunkType,
  type DiffLine,
  type DiffSide,
  type CommentThread,
  type LineNumber,
  type DiffViewMode,
  type LineSelection,
} from '../../types/diff';
import { DEFAULT_DIFF_VIEW_MODE } from '../../utils/diffMode';
import { threadReviewControls, useFixupOverlay } from '../contexts/FixupOverlayContext';
import { type CursorPosition } from '../hooks/keyboardNavigation';
import { useCanHover } from '../hooks/useCanHover';
import { useCodeSelection } from '../hooks/useCodeSelection';
import { useDirectEditing } from '../hooks/useDirectEditing';
import { quoteSelection } from '../utils/codeSelection';
import {
  computeWordLevelDiff,
  shouldComputeWordDiff,
  type DiffSegment,
} from '../utils/wordLevelDiff';

import { CommentForm } from './CommentForm';
import { CommentThreadCard } from './CommentThreadCard';
import { DiffLineRow } from './DiffLineRow';
import { DirectEditForm } from './DirectEditForm';
import { EditHunkButton } from './EditLineButton';
import { FixupBoxRows, FixupOverlayRow } from './FixupOverlayCard';
import {
  type FoldedLines,
  FoldedLinesRow,
  foldAt,
  lockFoldsUnderForms,
  NO_FOLDS,
} from './FoldedLines';
import { SelectionCommentBar } from './SelectionCommentBar';
import type { AppearanceSettings } from './SettingsModal';
import { SideBySideDiffChunk } from './SideBySideDiffChunk';

interface DiffChunkProps {
  chunk: DiffChunkType;
  chunkIndex: number;
  threads: CommentThread[];
  showAuthorBadges?: boolean;
  // Left out where the diff takes no comments.
  onAddComment?: (
    line: LineNumber,
    body: string,
    codeContent?: string,
    side?: DiffSide,
  ) => Promise<void>;
  onResolveThread: (threadId: string) => void;
  onReplyToThread: (threadId: string, body: string) => Promise<void>;
  onRemoveMessage: (threadId: string, messageId: string) => void;
  onUpdateMessage: (threadId: string, messageId: string, newBody: string) => void;
  mode?: DiffViewMode;
  syntaxTheme?: AppearanceSettings['syntaxTheme'];
  cursor?: CursorPosition | null;
  fileIndex?: number;
  onLineClick?: (
    fileIndex: number,
    chunkIndex: number,
    lineIndex: number,
    side: 'left' | 'right',
  ) => void;
  commentTrigger?: {
    fileIndex: number;
    chunkIndex: number;
    lineIndex: number;
  } | null;
  onCommentTriggerHandled?: () => void;
  filename?: string;
  onOpenInEditor?: (filePath: string, lineNumber: number) => void;
  foldedLines?: readonly FoldedLines[];
}

export const DiffChunk = memo(function DiffChunk({
  chunk,
  chunkIndex,
  threads,
  showAuthorBadges = false,
  onAddComment,
  onResolveThread,
  onReplyToThread,
  onRemoveMessage,
  onUpdateMessage,
  mode = DEFAULT_DIFF_VIEW_MODE,
  syntaxTheme,
  cursor = null,
  fileIndex = 0,
  onLineClick,
  commentTrigger,
  onCommentTriggerHandled,
  filename,
  onOpenInEditor,
  foldedLines = NO_FOLDS,
}: DiffChunkProps) {
  const [startLine, setStartLine] = useState<number | null>(null);
  const [endLine, setEndLine] = useState<number | null>(null);
  const [dragSide, setDragSide] = useState<DiffSide | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [openCommentLine, setCommentingLine] = useState<{
    side: DiffSide;
    lineNumber: LineNumber;
    quote?: string;
  } | null>(null);
  const commentingLine = onAddComment ? openCommentLine : null;
  const [selectionAnchor, setSelectionAnchor] = useState<{
    side: DiffSide;
    lineNumber: number;
  } | null>(null);
  const [hoveredLine, setHoveredLine] = useState<number | null>(null);
  const dragFromLineNumber = useRef(false);
  const overlay = useFixupOverlay();
  const directEditing = useDirectEditing(chunk.lines, threads);
  const canHover = useCanHover();
  const containerRef = useRef<HTMLDivElement>(null);
  const codeSelection = useCodeSelection(containerRef, 'unified');

  // Handle comment trigger from keyboard navigation
  useEffect(() => {
    if (commentTrigger?.lineIndex !== undefined) {
      const line = chunk.lines[commentTrigger.lineIndex];
      if (line) {
        const lineNumber = line.newLineNumber || line.oldLineNumber;
        const side: DiffSide = line.type === 'delete' ? 'old' : 'new';
        if (lineNumber) {
          setCommentingLine({ side, lineNumber });
          onCommentTriggerHandled?.();
        }
      }
    }
  }, [commentTrigger, chunk.lines, onCommentTriggerHandled]);

  const handleAddComment = useCallback(
    (side: DiffSide, lineNumber: LineNumber) => {
      if (commentingLine?.side === side && commentingLine?.lineNumber === lineNumber) {
        setCommentingLine(null);
      } else {
        setCommentingLine({ side, lineNumber });
      }
    },
    [commentingLine],
  );

  const getCommentLineFromAnchor = (selection: LineSelection): LineNumber => {
    if (!selectionAnchor || selectionAnchor.side !== selection.side) {
      return selection.lineNumber;
    }

    const min = Math.min(selectionAnchor.lineNumber, selection.lineNumber);
    const max = Math.max(selectionAnchor.lineNumber, selection.lineNumber);
    return min === max ? selection.lineNumber : [min, max];
  };

  const openShiftClickComment = (selection: LineSelection) => {
    handleAddComment(selection.side, getCommentLineFromAnchor(selection));
    setSelectionAnchor(selection);
  };

  const startCommentDrag = (selection: LineSelection, fromLineNumber = false) => {
    if (!onAddComment) return;
    dragFromLineNumber.current = fromLineNumber;
    setSelectionAnchor(selection);
    setStartLine(selection.lineNumber);
    setEndLine(selection.lineNumber);
    setDragSide(selection.side);
    setIsDragging(true);
  };

  const handleCommentButtonMouseDown = ({
    isShiftClick,
    selection,
  }: {
    isShiftClick: boolean;
    selection: LineSelection | null;
  }) => {
    if (!selection) return;

    if (isShiftClick) {
      openShiftClickComment(selection);
      return;
    }

    startCommentDrag(selection);
  };

  const handleRowClick = ({
    isShiftClick,
    lineIndex,
    navigationSide,
    selection,
  }: {
    isShiftClick: boolean;
    lineIndex: number;
    navigationSide: 'left' | 'right';
    selection: LineSelection | null;
  }) => {
    if (!selection) {
      onLineClick?.(fileIndex, chunkIndex, lineIndex, navigationSide);
      return;
    }

    if (isShiftClick) {
      openShiftClickComment(selection);
      return;
    }

    setSelectionAnchor(selection);
    onLineClick?.(fileIndex, chunkIndex, lineIndex, navigationSide);
  };

  // Global mouse up handler for drag selection: commit the selection wherever
  // the mouse is released, not only on the comment button itself
  useEffect(() => {
    if (!isDragging) {
      return undefined;
    }

    const handleGlobalMouseUp = () => {
      // Defer so the click event fired after mouseup doesn't immediately
      // close the newly opened (still empty) comment form
      setTimeout(() => {
        const actualEndLine = endLine ?? startLine;
        const clickedLineNumber = dragFromLineNumber.current && startLine === actualEndLine;
        if (startLine && actualEndLine && dragSide && !clickedLineNumber) {
          if (startLine === actualEndLine) {
            handleAddComment(dragSide, startLine);
          } else {
            const min = Math.min(startLine, actualEndLine);
            const max = Math.max(startLine, actualEndLine);
            handleAddComment(dragSide, [min, max]);
          }
        }
        setIsDragging(false);
        setStartLine(null);
        setEndLine(null);
        setDragSide(null);
      }, 0);
    };

    document.addEventListener('mouseup', handleGlobalMouseUp);
    return () => {
      document.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [isDragging, startLine, endLine, dragSide, handleAddComment]);

  const handleCancelComment = useCallback(() => {
    setCommentingLine(null);
  }, []);

  // Get the code content for the selected lines (for suggestion feature)
  const getSelectedCodeContent = useCallback((): string => {
    if (!commentingLine) return '';

    const { side, lineNumber } = commentingLine;
    const lines = chunk.lines;

    if (typeof lineNumber === 'number') {
      // Single line
      const line = lines.find((l) =>
        side === 'old' ? l.oldLineNumber === lineNumber : l.newLineNumber === lineNumber,
      );
      return line?.content ?? '';
    } else {
      // Range of lines
      const [start, end] = lineNumber;
      const selectedLines = lines.filter((l) => {
        const ln = side === 'old' ? l.oldLineNumber : l.newLineNumber;
        return ln !== undefined && ln >= start && ln <= end;
      });
      return selectedLines.map((l) => l.content ?? '').join('\n');
    }
  }, [commentingLine, chunk.lines]);

  const handleSubmitComment = useCallback(
    async (body: string) => {
      if (commentingLine !== null && onAddComment) {
        const codeContent = getSelectedCodeContent();
        const fullBody =
          commentingLine.quote === undefined ? body : quoteSelection(commentingLine.quote, body);
        await onAddComment(commentingLine.lineNumber, fullBody, codeContent, commentingLine.side);
        setCommentingLine(null);
      }
    },
    [commentingLine, onAddComment, getSelectedCodeContent],
  );

  const getThreadsForLine = (lineNumber: number, side: DiffSide) => {
    return threads
      .filter((thread) => {
        const lineMatches = Array.isArray(thread.line)
          ? thread.line[1] === lineNumber
          : thread.line === lineNumber;
        const sideMatches = !thread.side || thread.side === side;
        return lineMatches && sideMatches;
      })
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  };

  const getCommentLayout = (line: DiffLine): 'left' | 'right' | 'full' => {
    // In unified mode, always use full width for comments
    if (mode === 'unified') {
      return 'full';
    }

    switch (line.type) {
      case 'delete':
        return 'left';
      case 'add':
        return 'right';
      default:
        return 'full';
    }
  };

  const getSelectedLineStyle = (lineNumber: number | undefined, side: DiffSide): string => {
    if (!lineNumber) {
      return '';
    }

    // Show selection during drag
    if (isDragging && startLine && endLine) {
      const min = Math.min(startLine, endLine);
      const max = Math.max(startLine, endLine);
      if (lineNumber >= min && lineNumber <= max) {
        let classes = 'drag-selected';
        // Add top border for first line
        if (lineNumber === min) {
          classes += ' drag-selected-first';
        }
        // Add bottom border for last line
        if (lineNumber === max) {
          classes += ' drag-selected-last';
        }
        return classes;
      }
    }

    // Show selection for existing comment
    if (commentingLine && commentingLine.side === side) {
      const start = Array.isArray(commentingLine.lineNumber)
        ? commentingLine.lineNumber[0]
        : commentingLine.lineNumber;
      const end = Array.isArray(commentingLine.lineNumber)
        ? commentingLine.lineNumber[1]
        : commentingLine.lineNumber;
      if (lineNumber >= start && lineNumber <= end) {
        return 'comment-selected';
      }
    }

    return '';
  };

  // Compute word-level diff for unified mode
  // Maps line index to diff segments for that line
  const wordLevelDiffMap = useMemo(() => {
    const map = new Map<number, DiffSegment[]>();
    const lines = chunk.lines;

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line) {
        i++;
        continue;
      }

      if (line.type === 'delete') {
        // Look ahead for corresponding add lines
        let j = i + 1;
        while (j < lines.length && lines[j]?.type === 'delete') {
          j++;
        }

        const deleteLines = lines.slice(i, j);
        const deleteStartIndex = i;
        const addLines: { line: DiffLine; index: number }[] = [];

        while (j < lines.length && lines[j]?.type === 'add') {
          const addLine = lines[j];
          if (addLine) {
            addLines.push({ line: addLine, index: j });
          }
          j++;
        }

        // Pair delete and add lines and compute word-level diff
        const maxLines = Math.max(deleteLines.length, addLines.length);
        for (let k = 0; k < maxLines; k++) {
          const deleteLine = deleteLines[k];
          const addLineInfo = addLines[k];

          if (deleteLine && addLineInfo) {
            if (shouldComputeWordDiff(deleteLine.content, addLineInfo.line.content)) {
              const wordLevelDiff = computeWordLevelDiff(
                deleteLine.content,
                addLineInfo.line.content,
              );
              map.set(deleteStartIndex + k, wordLevelDiff.oldSegments);
              map.set(addLineInfo.index, wordLevelDiff.newSegments);
            }
          }
        }

        i = j;
      } else {
        i++;
      }
    }

    return map;
  }, [chunk.lines]);

  // Use side-by-side component for split mode
  if (mode === 'split') {
    return (
      <SideBySideDiffChunk
        chunk={chunk}
        chunkIndex={chunkIndex}
        threads={threads}
        showAuthorBadges={showAuthorBadges}
        onAddComment={onAddComment}
        onResolveThread={onResolveThread}
        onReplyToThread={onReplyToThread}
        onRemoveMessage={onRemoveMessage}
        onUpdateMessage={onUpdateMessage}
        onOpenInEditor={onOpenInEditor}
        syntaxTheme={syntaxTheme}
        cursor={cursor}
        fileIndex={fileIndex}
        onLineClick={onLineClick}
        filename={filename}
        commentTrigger={commentTrigger}
        onCommentTriggerHandled={onCommentTriggerHandled}
        foldedLines={foldedLines}
      />
    );
  }

  const { editing, editLine, editHunk, editRange } = directEditing;
  const folds = lockFoldsUnderForms(foldedLines, chunk.lines, commentingLine, editing);
  const selected = codeSelection.selected;

  return (
    <div ref={containerRef} className="group/hunk relative bg-github-bg-primary">
      {editHunk && <EditHunkButton onClick={editHunk} />}
      {selected && onAddComment && (
        <SelectionCommentBar
          range={selected.range}
          container={containerRef.current}
          canHover={canHover}
          onPress={codeSelection.hold}
          onComment={() => {
            setCommentingLine({
              side: selected.side,
              lineNumber: selected.lineNumber,
              quote: selected.text,
            });
            codeSelection.clear();
          }}
          onEdit={
            editRange && selected.side === 'new'
              ? () => {
                  const [start, end] = Array.isArray(selected.lineNumber)
                    ? selected.lineNumber
                    : [selected.lineNumber, selected.lineNumber];
                  editRange({ start, end });
                  codeSelection.clear();
                }
              : undefined
          }
        />
      )}
      <table className="w-full table-fixed border-collapse font-mono text-sm leading-5">
        <colgroup>
          <col className="w-[var(--line-number-width)]" />
          <col className="w-[var(--line-number-width)]" />
          <col className="w-full" />
        </colgroup>
        <tbody>
          {chunk.lines.map((line, index) => {
            const fold = foldAt(folds, index);
            if (fold?.folded) {
              return index === fold.start ? (
                <React.Fragment key={index}>
                  <FoldedLinesRow fold={fold} colSpan={3} />
                </React.Fragment>
              ) : null;
            }
            const currentLineNumber = line.newLineNumber || line.oldLineNumber || 0;
            const currentLineSide: DiffSide = line.type === 'delete' ? 'old' : 'new';
            const formTargetLineNumber = commentingLine
              ? Array.isArray(commentingLine.lineNumber)
                ? commentingLine.lineNumber[1]
                : commentingLine.lineNumber
              : null;

            // Determine which line number and side to use for fetching comments
            // Delete lines: use oldLineNumber and 'old' side
            // Add/normal lines: use newLineNumber and 'new' side
            const commentLineNumber =
              line.type === 'delete' ? line.oldLineNumber : line.newLineNumber;
            const commentSide: DiffSide = line.type === 'delete' ? 'old' : 'new';
            const lineThreads = commentLineNumber
              ? getThreadsForLine(commentLineNumber, commentSide)
              : [];
            // Generate ID for all lines to match the format used in useKeyboardNavigation
            const lineId = `file-${fileIndex}-chunk-${chunkIndex}-line-${index}`;
            const isCurrentLine =
              cursor && cursor.chunkIndex === chunkIndex && cursor.lineIndex === index;
            const selection = commentLineNumber
              ? { side: commentSide, lineNumber: commentLineNumber }
              : null;

            return (
              <React.Fragment key={index}>
                {fold && index === fold.start && <FoldedLinesRow fold={fold} colSpan={3} />}
                <DiffLineRow
                  line={line}
                  index={index}
                  lineId={lineId}
                  isCurrentLine={isCurrentLine || false}
                  hoveredLineIndex={hoveredLine}
                  selectedLineStyle={getSelectedLineStyle(
                    line.newLineNumber || line.oldLineNumber,
                    line.type === 'delete' ? 'old' : 'new',
                  )}
                  onMouseEnter={() => {
                    setHoveredLine(index);
                  }}
                  onMouseLeave={() => setHoveredLine(null)}
                  onMouseMove={() => {
                    if (isDragging && startLine) {
                      const lineNumber = line.newLineNumber || line.oldLineNumber;
                      if (lineNumber) {
                        setEndLine(lineNumber);
                      }
                    }
                  }}
                  onCommentButtonMouseDown={
                    onAddComment &&
                    ((e) => {
                      e.stopPropagation();
                      if (e.shiftKey) {
                        e.preventDefault();
                      }
                      handleCommentButtonMouseDown({
                        isShiftClick: e.shiftKey,
                        selection,
                      });
                    })
                  }
                  onComment={
                    onAddComment &&
                    (() => {
                      if (selection) handleAddComment(selection.side, selection.lineNumber);
                    })
                  }
                  onLineNumberMouseDown={(e) => {
                    if (e.button !== 0 || e.shiftKey || !selection) return;
                    e.preventDefault();
                    startCommentDrag(selection, true);
                  }}
                  canHover={canHover}
                  onOpenInEditor={
                    onOpenInEditor &&
                    filename &&
                    line.type !== 'delete' &&
                    (line.newLineNumber || line.oldLineNumber)
                      ? () => {
                          const lineNumber = line.newLineNumber || line.oldLineNumber;
                          if (!lineNumber) return;
                          if (!filename) return;
                          onOpenInEditor(filename, lineNumber);
                        }
                      : undefined
                  }
                  onEditLine={
                    editLine && line.type !== 'delete' && line.newLineNumber
                      ? () => editLine(line.newLineNumber ?? 0)
                      : undefined
                  }
                  syntaxTheme={syntaxTheme}
                  filename={filename}
                  diffSegments={wordLevelDiffMap.get(index)}
                  onClick={(e) => {
                    // Determine the side based on line type for unified mode
                    const side = line.type === 'delete' ? 'left' : 'right';
                    if (e.shiftKey) {
                      e.preventDefault();
                    }
                    handleRowClick({
                      isShiftClick: e.shiftKey,
                      lineIndex: index,
                      navigationSide: side,
                      selection,
                    });
                  }}
                />

                <FixupBoxRows
                  filePath={filename}
                  lineNumber={line.type === 'delete' ? undefined : line.newLineNumber}
                  colSpan={3}
                  syntaxTheme={syntaxTheme}
                />

                {lineThreads.map((thread) => {
                  const layout = getCommentLayout(line);
                  const review = threadReviewControls(overlay, thread);
                  return (
                    <React.Fragment key={thread.id}>
                      <FixupOverlayRow
                        thread={thread}
                        filePath={filename}
                        colSpan={3}
                        syntaxTheme={syntaxTheme}
                      />
                      <tr className="bg-github-bg-secondary">
                        <td colSpan={3} className="p-0 border-t border-github-border">
                          <div
                            className={`flex ${
                              layout === 'left'
                                ? 'justify-start'
                                : layout === 'right'
                                  ? 'justify-end'
                                  : 'justify-center'
                            }`}
                          >
                            <div
                              className={`${layout === 'full' ? 'w-full' : 'w-1/2'} m-2 mx-4 min-w-0`}
                            >
                              <CommentThreadCard
                                thread={thread}
                                review={review}
                                showAuthorBadges={showAuthorBadges}
                                onResolveThread={onResolveThread}
                                onReplyToThread={onReplyToThread}
                                onRemoveMessage={onRemoveMessage}
                                onUpdateMessage={onUpdateMessage}
                                onEditDirectly={directEditing.editThread(thread)}
                                syntaxTheme={syntaxTheme}
                              />
                            </div>
                          </div>
                        </td>
                      </tr>
                    </React.Fragment>
                  );
                })}

                {editing &&
                  directEditing.controls &&
                  directEditing.targetCommit &&
                  filename &&
                  line.type !== 'delete' &&
                  line.newLineNumber === editing.end && (
                    <tr className="bg-github-bg-secondary">
                      <td colSpan={3} className="p-0">
                        <DirectEditForm
                          key={`${editing.start}-${editing.end}-${editing.threadId ?? ''}`}
                          filePath={filename}
                          range={editing}
                          targetCommit={directEditing.targetCommit}
                          threadId={editing.threadId}
                          controls={directEditing.controls}
                          onClose={directEditing.close}
                        />
                      </td>
                    </tr>
                  )}

                {commentingLine &&
                  commentingLine.side === currentLineSide &&
                  formTargetLineNumber === currentLineNumber && (
                    <tr className="bg-[var(--bg-secondary)]">
                      <td colSpan={3} className="p-0">
                        <div
                          className={`flex ${
                            getCommentLayout(line) === 'left'
                              ? 'justify-start'
                              : getCommentLayout(line) === 'right'
                                ? 'justify-end'
                                : 'justify-center'
                          }`}
                        >
                          <div
                            className={`${getCommentLayout(line) === 'full' ? 'w-full' : 'w-1/2'}`}
                          >
                            <CommentForm
                              onSubmit={handleSubmitComment}
                              onCancel={handleCancelComment}
                              quote={commentingLine.quote}
                              selectedCode={getSelectedCodeContent()}
                              syntaxTheme={syntaxTheme}
                              filename={filename}
                            />
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
});
