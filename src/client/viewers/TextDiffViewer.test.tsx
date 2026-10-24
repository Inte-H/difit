import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ChunkChangeKind, CommentThread, DiffFile } from '../../types/diff';
import { WordHighlightProvider } from '../contexts/WordHighlightContext';
import type { MergedChunk } from '../hooks/useExpandedLines';

import { TextDiffViewer } from './TextDiffViewer';
import type { DiffViewerBodyProps } from './types';

const chunk = (changeKind: ChunkChangeKind | undefined, start: number): MergedChunk => ({
  header: `@@ -${start},2 +${start},2 @@`,
  oldStart: start,
  oldLines: 2,
  newStart: start,
  newLines: 2,
  changeKind,
  originalIndices: [start],
  originalLineRanges: [{ originalIndex: start, start: 0, end: 2, changeKind }],
  hiddenLinesBefore: 0,
  hiddenLinesAfter: 0,
  lines: [
    { type: 'delete', content: `// old ${start}`, oldLineNumber: start },
    { type: 'add', content: `// new ${start}`, newLineNumber: start },
    { type: 'normal', content: `f${start}();`, oldLineNumber: start + 1, newLineNumber: start + 1 },
  ],
});

const file: DiffFile = {
  path: 'src/a.ts',
  status: 'modified',
  additions: 2,
  deletions: 2,
  chunks: [],
};

const shown = (code: string) => document.body.textContent?.includes(code) ?? false;
const noop = () => {};
const asyncNoop = async () => {};

function viewer(props: Partial<DiffViewerBodyProps>) {
  return (
    <WordHighlightProvider>
      <TextDiffViewer
        file={file}
        threads={[]}
        diffMode="unified"
        mergedChunks={[chunk('comment', 10), chunk('code', 40)]}
        foldCommentChanges
        isExpandLoading={false}
        expandHiddenLines={asyncNoop}
        expandAllBetweenChunks={asyncNoop}
        onAddComment={asyncNoop}
        onResolveThread={noop}
        onReplyToThread={asyncNoop}
        onRemoveMessage={noop}
        onUpdateMessage={noop}
        {...props}
      />
    </WordHighlightProvider>
  );
}

function renderViewer(props: Partial<DiffViewerBodyProps>) {
  return render(viewer(props));
}

// A code change and a comment-only change joined by the opened line between them.
const codeThenComment = (): MergedChunk => ({
  header: '@@ -1,5 +1,5 @@',
  oldStart: 1,
  oldLines: 5,
  newStart: 1,
  newLines: 5,
  changeKind: 'code',
  originalIndices: [0, 1],
  originalLineRanges: [
    { originalIndex: 0, start: 0, end: 2, changeKind: 'code' },
    { originalIndex: 1, start: 4, end: 6, changeKind: 'comment' },
  ],
  hiddenLinesBefore: 0,
  hiddenLinesAfter: 0,
  lines: [
    { type: 'delete', content: 'a = 1;', oldLineNumber: 1 },
    { type: 'add', content: 'a = 2;', newLineNumber: 1 },
    { type: 'normal', content: 'b();', oldLineNumber: 2, newLineNumber: 2 },
    { type: 'normal', content: 'opened();', oldLineNumber: 3, newLineNumber: 3 },
    { type: 'delete', content: '// old note', oldLineNumber: 4 },
    { type: 'add', content: '// new note', newLineNumber: 4 },
    { type: 'normal', content: 'c();', oldLineNumber: 5, newLineNumber: 5 },
  ],
});

const codeThenTwoComments = (): MergedChunk => {
  const base = codeThenComment();
  return {
    ...base,
    header: '@@ -1,7 +1,7 @@',
    oldLines: 7,
    newLines: 7,
    originalIndices: [0, 1, 2],
    originalLineRanges: [
      ...base.originalLineRanges,
      { originalIndex: 2, start: 8, end: 9, changeKind: 'comment' },
    ],
    lines: [
      ...base.lines,
      { type: 'normal', content: 'd();', oldLineNumber: 6, newLineNumber: 6 },
      { type: 'delete', content: '// old tail', oldLineNumber: 7 },
      { type: 'add', content: '// new tail', newLineNumber: 7 },
    ],
  };
};

describe('TextDiffViewer folding', () => {
  it('folds a comment-only chunk into one line and opens it on click', () => {
    renderViewer({});

    const fold = screen.getByRole('button', { name: '주석 1줄 바뀜 · 펼치기' });
    expect(shown('// new 10')).toBe(false);
    expect(shown('// new 40')).toBe(true);

    fireEvent.click(fold);
    expect(shown('// new 10')).toBe(true);
    expect(screen.queryByRole('button', { name: /펼치기/ })).toBeNull();
  });

  it('folds an opened chunk again when folding is turned off and back on', () => {
    const { rerender } = renderViewer({});
    fireEvent.click(screen.getByRole('button', { name: '주석 1줄 바뀜 · 펼치기' }));

    rerender(viewer({ foldCommentChanges: false }));
    rerender(viewer({ foldCommentChanges: true }));

    expect(shown('// new 10')).toBe(false);
    expect(screen.getByRole('button', { name: '주석 1줄 바뀜 · 펼치기' })).toBeInTheDocument();
  });

  it.each(['unified', 'split'] as const)(
    'folds the comment-only part of a chunk that also changes code in %s mode',
    (diffMode) => {
      renderViewer({ mergedChunks: [codeThenComment()], diffMode });

      const fold = screen.getByRole('button', { name: '주석 1줄 바뀜 · 펼치기' });
      expect(shown('a = 2;')).toBe(true);
      expect(shown('opened();')).toBe(true);
      expect(shown('// new note')).toBe(false);
      expect(shown('c();')).toBe(false);

      fireEvent.click(fold);
      expect(shown('// new note')).toBe(true);
    },
  );

  it.each(['unified', 'split'] as const)(
    'folds an opened part again from its header in %s mode',
    (diffMode) => {
      renderViewer({ mergedChunks: [codeThenComment()], diffMode });

      fireEvent.click(screen.getByRole('button', { name: '주석 1줄 바뀜 · 펼치기' }));
      const header = screen.getByRole('button', { name: '주석 1줄 바뀜 · 접기' });
      expect(shown('// new note')).toBe(true);

      fireEvent.click(header);
      expect(shown('// new note')).toBe(false);
      expect(shown('a = 2;')).toBe(true);
      expect(screen.getByRole('button', { name: '주석 1줄 바뀜 · 펼치기' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /접기/ })).toBeNull();
    },
  );

  it('folds an opened part from its header while the cursor is inside it', () => {
    const { rerender } = renderViewer({ mergedChunks: [codeThenComment()] });
    fireEvent.click(screen.getByRole('button', { name: '주석 1줄 바뀜 · 펼치기' }));
    rerender(
      viewer({
        mergedChunks: [codeThenComment()],
        cursor: { fileIndex: 0, chunkIndex: 0, lineIndex: 5, side: 'right' },
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: '주석 1줄 바뀜 · 접기' }));

    expect(shown('// new note')).toBe(false);
    expect(screen.getByRole('button', { name: '주석 1줄 바뀜 · 펼치기' })).toBeInTheDocument();
  });

  it('folds a part the cursor opened until the cursor moves', () => {
    const { rerender } = renderViewer({
      mergedChunks: [codeThenComment()],
      cursor: { fileIndex: 0, chunkIndex: 0, lineIndex: 5, side: 'right' },
    });

    fireEvent.click(screen.getByRole('button', { name: '주석 1줄 바뀜 · 접기' }));
    expect(shown('// new note')).toBe(false);

    rerender(
      viewer({
        mergedChunks: [codeThenComment()],
        cursor: { fileIndex: 0, chunkIndex: 0, lineIndex: 6, side: 'right' },
      }),
    );
    expect(shown('// new note')).toBe(true);
  });

  it.each(['unified', 'split'] as const)(
    'keeps a part folded over the cursor while another part is toggled in %s mode',
    (diffMode) => {
      const twoNotes = codeThenTwoComments();
      renderViewer({
        mergedChunks: [twoNotes],
        diffMode,
        cursor: { fileIndex: 0, chunkIndex: 0, lineIndex: 5, side: 'right' },
      });

      fireEvent.click(screen.getByRole('button', { name: '주석 1줄 바뀜 · 접기' }));
      const folds = screen.getAllByRole('button', { name: '주석 1줄 바뀜 · 펼치기' });
      fireEvent.click(folds[1]!);

      expect(shown('// new tail')).toBe(true);
      expect(shown('// new note')).toBe(false);
    },
  );

  it('forgets a part folded over the cursor when folding is turned off', () => {
    const cursor = { fileIndex: 0, chunkIndex: 0, lineIndex: 5, side: 'right' } as const;
    const { rerender } = renderViewer({ mergedChunks: [codeThenComment()], cursor });
    fireEvent.click(screen.getByRole('button', { name: '주석 1줄 바뀜 · 접기' }));

    rerender(viewer({ mergedChunks: [codeThenComment()], cursor, foldCommentChanges: false }));
    rerender(viewer({ mergedChunks: [codeThenComment()], cursor }));

    expect(shown('// new note')).toBe(true);
  });

  it.each(['unified', 'split'] as const)(
    'cannot fold a part while a comment form is open in it in %s mode',
    (diffMode) => {
      renderViewer({
        mergedChunks: [codeThenComment()],
        diffMode,
        cursor: { fileIndex: 0, chunkIndex: 0, lineIndex: 5, side: 'right' },
        commentTrigger: { fileIndex: 0, chunkIndex: 0, lineIndex: 5 },
      });

      expect(screen.getByRole('textbox')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '주석 1줄 바뀜 · 접기' })).toBeDisabled();
    },
  );

  it.each(['unified', 'split'] as const)(
    'keeps focus on the header across folding in %s mode',
    (diffMode) => {
      renderViewer({ mergedChunks: [codeThenComment()], diffMode });
      const header = screen.getByRole('button', { name: '주석 1줄 바뀜 · 펼치기' });
      header.focus();

      fireEvent.click(header);

      expect(document.activeElement).toBe(header);
      expect(header).toHaveAccessibleName('주석 1줄 바뀜 · 접기');
    },
  );

  it('keeps the comment-only part folded while the cursor is outside it', () => {
    renderViewer({
      mergedChunks: [codeThenComment()],
      cursor: { fileIndex: 0, chunkIndex: 0, lineIndex: 3, side: 'right' },
    });

    expect(screen.getByRole('button', { name: '주석 1줄 바뀜 · 펼치기' })).toBeInTheDocument();
  });

  it('opens the comment-only part when the cursor moves into it', () => {
    renderViewer({
      mergedChunks: [codeThenComment()],
      cursor: { fileIndex: 0, chunkIndex: 0, lineIndex: 5, side: 'right' },
    });

    expect(shown('// new note')).toBe(true);
  });

  it.each(['unified', 'split'] as const)(
    'keeps a comment form open after the cursor leaves the folded part in %s mode',
    (diffMode) => {
      const { rerender } = renderViewer({
        mergedChunks: [codeThenComment()],
        diffMode,
        cursor: { fileIndex: 0, chunkIndex: 0, lineIndex: 5, side: 'right' },
        commentTrigger: { fileIndex: 0, chunkIndex: 0, lineIndex: 5 },
      });
      expect(screen.getByRole('textbox')).toBeInTheDocument();

      rerender(
        viewer({
          mergedChunks: [codeThenComment()],
          diffMode,
          cursor: { fileIndex: 0, chunkIndex: 0, lineIndex: 0, side: 'right' },
          commentTrigger: null,
        }),
      );

      expect(screen.getByRole('textbox')).toBeInTheDocument();
      expect(shown('// new note')).toBe(true);
    },
  );

  it('keeps a comment form open on a wholly folded chunk after the cursor leaves it', () => {
    const { rerender } = renderViewer({
      cursor: { fileIndex: 0, chunkIndex: 0, lineIndex: 1, side: 'right' },
      commentTrigger: { fileIndex: 0, chunkIndex: 0, lineIndex: 1 },
    });
    expect(screen.getByRole('textbox')).toBeInTheDocument();

    rerender(
      viewer({
        cursor: { fileIndex: 0, chunkIndex: 1, lineIndex: 0, side: 'right' },
        commentTrigger: null,
      }),
    );

    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(shown('// new 10')).toBe(true);
  });

  it('folds and opens each comment-only part of one chunk on its own', () => {
    const twoNotes = codeThenTwoComments();
    const thread: CommentThread = {
      id: 't1',
      file: 'src/a.ts',
      line: 7,
      side: 'new',
      createdAt: '2026-10-23T00:00:00.000Z',
      updatedAt: '2026-10-23T00:00:00.000Z',
      messages: [],
    };

    const { rerender } = renderViewer({ mergedChunks: [twoNotes] });
    const folds = screen.getAllByRole('button', { name: '주석 1줄 바뀜 · 펼치기' });
    expect(folds).toHaveLength(2);

    fireEvent.click(folds[1]!);
    expect(shown('// new tail')).toBe(true);
    expect(shown('// new note')).toBe(false);

    rerender(viewer({ mergedChunks: [twoNotes], foldCommentChanges: false }));
    rerender(viewer({ mergedChunks: [twoNotes], threads: [thread] }));
    expect(shown('// new tail')).toBe(true);
    expect(shown('// new note')).toBe(false);
  });

  it('labels a whitespace-only chunk as such', () => {
    renderViewer({ mergedChunks: [chunk('whitespace', 10)] });

    expect(screen.getByRole('button', { name: '공백 1줄 바뀜 · 펼치기' })).toBeInTheDocument();
  });

  it('counts the larger side when lines are split or joined', () => {
    const split = chunk('whitespace', 10);
    split.lines = [
      { type: 'delete', content: 'f(a, b);', oldLineNumber: 10 },
      { type: 'add', content: 'f(', newLineNumber: 10 },
      { type: 'add', content: '  a,', newLineNumber: 11 },
      { type: 'add', content: '  b);', newLineNumber: 12 },
    ];
    split.originalLineRanges = [{ originalIndex: 10, start: 0, end: 3, changeKind: 'whitespace' }];
    renderViewer({ mergedChunks: [split] });

    expect(screen.getByRole('button', { name: '공백 3줄 바뀜 · 펼치기' })).toBeInTheDocument();
  });

  it('adds up separate changes inside one chunk', () => {
    const twoPlaces = chunk('comment', 10);
    twoPlaces.lines = [
      { type: 'add', content: '// note', newLineNumber: 10 },
      { type: 'normal', content: 'f();', oldLineNumber: 10, newLineNumber: 11 },
      { type: 'delete', content: '// stale', oldLineNumber: 11 },
    ];
    renderViewer({ mergedChunks: [twoPlaces] });

    expect(screen.getByRole('button', { name: '주석 2줄 바뀜 · 펼치기' })).toBeInTheDocument();
  });

  it('shows every chunk when folding is off', () => {
    renderViewer({ foldCommentChanges: false });

    expect(shown('// new 10')).toBe(true);
    expect(screen.queryByRole('button', { name: /펼치기/ })).toBeNull();
  });

  it('keeps unclassified and unknown chunks open', () => {
    renderViewer({ mergedChunks: [chunk(undefined, 10), chunk('unknown', 40)] });

    expect(shown('// new 10')).toBe(true);
    expect(shown('// new 40')).toBe(true);
  });

  it('keeps a chunk open when a thread sits on it', () => {
    const thread: CommentThread = {
      id: 't1',
      file: 'src/a.ts',
      line: 11,
      side: 'new',
      createdAt: '2026-10-15T00:00:00.000Z',
      updatedAt: '2026-10-15T00:00:00.000Z',
      messages: [],
    };
    renderViewer({ threads: [thread] });

    expect(shown('// new 10')).toBe(true);
  });

  it('keeps a chunk open while the cursor is in it', () => {
    renderViewer({ cursor: { fileIndex: 0, chunkIndex: 0, lineIndex: 1, side: 'right' } });

    expect(shown('// new 10')).toBe(true);
  });
});
