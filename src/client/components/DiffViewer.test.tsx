import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { CommentThread, DiffChunk, DiffFile, ExpandedRange } from '../../types/diff';
import { EMPTY_FIXUP_OVERLAY, type FixupOverlayState } from '../contexts/FixupOverlayContext';
import { WordHighlightProvider } from '../contexts/WordHighlightContext';
import type { MergedChunk } from '../hooks/useExpandedLines';

import { DiffViewer } from './DiffViewer';

const changed = (oldStart: number, newStart: number): DiffChunk => ({
  header: `@@ -${oldStart},1 +${newStart},1 @@`,
  oldStart,
  oldLines: 1,
  newStart,
  newLines: 1,
  lines: [
    { type: 'delete', content: `old ${oldStart}`, oldLineNumber: oldStart },
    { type: 'add', content: `new ${newStart}`, newLineNumber: newStart },
  ],
});
const added = (after: number, newStart: number): DiffChunk => ({
  header: `@@ -${after},0 +${newStart},1 @@`,
  oldStart: after,
  oldLines: 0,
  newStart,
  newLines: 1,
  lines: [{ type: 'add', content: `added ${newStart}`, newLineNumber: newStart }],
});
const deleted = (oldStart: number, after: number): DiffChunk => ({
  header: `@@ -${oldStart},1 +${after},0 @@`,
  oldStart,
  oldLines: 1,
  newStart: after,
  newLines: 0,
  lines: [{ type: 'delete', content: `deleted ${oldStart}`, oldLineNumber: oldStart }],
});

const merged = (chunks: DiffChunk[]): MergedChunk[] =>
  chunks.map((chunk, index) => ({
    ...chunk,
    originalIndices: [index],
    originalLineRanges: [{ originalIndex: index, start: 0, end: chunk.lines.length }],
    hiddenLinesBefore: 1,
    hiddenLinesAfter: 1,
  }));

const threadAt = (line: number, side: 'old' | 'new'): CommentThread => ({
  id: 't1',
  file: 'a.ts',
  line,
  side,
  createdAt: '',
  updatedAt: '',
  messages: [],
});

function renderViewer(
  chunks: DiffChunk[],
  threads: CommentThread[],
  fixupOverlay?: FixupOverlayState,
) {
  const file: DiffFile = {
    path: 'a.ts',
    status: 'modified',
    additions: 1,
    deletions: 1,
    chunks,
  };
  const openLines = vi.fn<(file: DiffFile, ranges: readonly ExpandedRange[]) => Promise<void>>(
    async () => {},
  );
  render(
    <WordHighlightProvider>
      <DiffViewer
        file={file}
        threads={threads}
        diffMode="split"
        reviewedFiles={new Set()}
        collapsedFiles={new Set()}
        onToggleCollapsed={() => {}}
        onToggleAllCollapsed={() => {}}
        onResolveThread={() => {}}
        onReplyToThread={async () => {}}
        onRemoveMessage={() => {}}
        onUpdateMessage={() => {}}
        baseCommitish="base"
        targetCommitish="target"
        mergedChunks={merged(chunks)}
        openLines={openLines}
        prefetchFileContent={async () => {}}
        isExpandLoading={false}
        fixupOverlay={fixupOverlay}
      />
    </WordHighlightProvider>,
  );
  return openLines;
}

function openedFor(chunks: DiffChunk[], thread: CommentThread) {
  return renderViewer(chunks, [thread]).mock.calls.flatMap(([, ranges]) => ranges);
}

describe('DiffViewer opening the hidden lines a comment sits on', () => {
  it('opens the tail for a new-side comment when the last chunk only deletes', () => {
    const ranges = openedFor([changed(10, 10), deleted(30, 29)], threadAt(50, 'new'));

    expect(ranges).toContainEqual({ start: 31, end: Number.POSITIVE_INFINITY });
  });

  it('opens the tail for an old-side comment when the last chunk only adds', () => {
    const ranges = openedFor([changed(10, 10), added(30, 31)], threadAt(50, 'old'));

    expect(ranges).toContainEqual({ start: 30, end: Number.POSITIVE_INFINITY });
  });

  it('opens the lines on both sides of a chunk the comment side has no lines in', () => {
    const ranges = openedFor(
      [changed(10, 10), deleted(30, 29), changed(60, 59)],
      threadAt(20, 'new'),
    );

    expect(ranges).toContainEqual({ start: 11, end: 29 });
    expect(ranges).toContainEqual({ start: 31, end: 59 });
  });
});

describe('DiffViewer header of a file a fixup changed', () => {
  it('marks the file and goes to its fixup box when the mark is clicked', async () => {
    const revealFixupFile = vi.fn();
    renderViewer([changed(10, 10)], [], {
      ...EMPTY_FIXUP_OVERLAY,
      fixupTouchedFiles: new Map([['a.ts', { fixupSha: 'f1', path: 'a.ts' }]]),
      revealFixupFile,
    });

    await userEvent.setup().click(screen.getByRole('button', { name: 'fixup 수정' }));

    expect(revealFixupFile).toHaveBeenCalledWith('f1', 'a.ts');
  });

  it('leaves the file unmarked when no shown fixup changed it', () => {
    renderViewer([changed(10, 10)], [], {
      ...EMPTY_FIXUP_OVERLAY,
      fixupTouchedFiles: new Map([['b.ts', { fixupSha: 'f1', path: 'b.ts' }]]),
    });

    expect(screen.queryByRole('button', { name: 'fixup 수정' })).toBeNull();
  });
});
