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

function renderViewer(props: Partial<DiffViewerBodyProps>) {
  return render(
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
    </WordHighlightProvider>,
  );
}

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
