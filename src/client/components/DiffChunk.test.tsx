import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { CommentThread, DiffChunk as DiffChunkData, ThreadFixup } from '../../types/diff';
import { DEFAULT_DIFF_VIEW_MODE } from '../../utils/diffMode';
import {
  EMPTY_FIXUP_OVERLAY,
  FixupOverlayProvider,
  type FixupOverlayState,
} from '../contexts/FixupOverlayContext';
import { WordHighlightProvider } from '../contexts/WordHighlightContext';

import { DiffChunk } from './DiffChunk';
import { SideBySideDiffChunk } from './SideBySideDiffChunk';

const testChunk: DiffChunkData = {
  header: '@@ -10,3 +10,3 @@',
  oldStart: 10,
  oldLines: 2,
  newStart: 10,
  newLines: 3,
  lines: [
    {
      type: 'normal',
      content: 'const first = 1;',
      oldLineNumber: 10,
      newLineNumber: 10,
    },
    {
      type: 'normal',
      content: 'const second = 2;',
      oldLineNumber: 11,
      newLineNumber: 11,
    },
    {
      type: 'add',
      content: 'const third = 3;',
      newLineNumber: 12,
    },
  ],
};

const noop = () => {};
const asyncNoop = async () => {};
const renderWithProviders = (ui: ReactNode) =>
  render(<WordHighlightProvider>{ui}</WordHighlightProvider>);

describe('DiffChunk range comments', () => {
  it('opens a unified range comment with shift-click', async () => {
    const onAddComment = vi.fn().mockResolvedValue(undefined);
    const { container } = renderWithProviders(
      <DiffChunk
        chunk={testChunk}
        chunkIndex={0}
        threads={[]}
        mode="unified"
        onAddComment={onAddComment}
        onGenerateThreadPrompt={() => ''}
        onRemoveThread={noop}
        onReplyToThread={asyncNoop}
        onRemoveMessage={noop}
        onUpdateMessage={noop}
        filename="src/example.ts"
      />,
    );

    const rows = container.querySelectorAll('[data-diff-line-row="true"]');
    fireEvent.click(rows[0]!);
    fireEvent.click(rows[2]!, { shiftKey: true });

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Please revisit this range' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => {
      expect(onAddComment).toHaveBeenCalledWith(
        [10, 12],
        'Please revisit this range',
        ['const first = 1;', 'const second = 2;', 'const third = 3;'].join('\n'),
        'new',
      );
    });
  });

  it('opens a split-view range comment with shift-click on the same side', async () => {
    const onAddComment = vi.fn().mockResolvedValue(undefined);
    const { container } = renderWithProviders(
      <SideBySideDiffChunk
        chunk={testChunk}
        chunkIndex={0}
        threads={[]}
        onAddComment={onAddComment}
        onGenerateThreadPrompt={() => ''}
        onRemoveThread={noop}
        onReplyToThread={asyncNoop}
        onRemoveMessage={noop}
        onUpdateMessage={noop}
        filename="src/example.ts"
      />,
    );

    const rows = container.querySelectorAll('[data-diff-line-row="true"]');
    fireEvent.click(rows[0]!.children[2]!);
    fireEvent.click(rows[2]!.children[2]!, { shiftKey: true });

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Please revisit this range' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => {
      expect(onAddComment).toHaveBeenCalledWith(
        [10, 12],
        'Please revisit this range',
        ['const first = 1;', 'const second = 2;', 'const third = 3;'].join('\n'),
        'new',
      );
    });
  });

  it('falls back to a single-line comment when shift-click has no anchor', async () => {
    const onAddComment = vi.fn().mockResolvedValue(undefined);
    const { container } = renderWithProviders(
      <DiffChunk
        chunk={testChunk}
        chunkIndex={0}
        threads={[]}
        mode={DEFAULT_DIFF_VIEW_MODE}
        onAddComment={onAddComment}
        onGenerateThreadPrompt={() => ''}
        onRemoveThread={noop}
        onReplyToThread={asyncNoop}
        onRemoveMessage={noop}
        onUpdateMessage={noop}
        filename="src/example.ts"
      />,
    );

    const rows = container.querySelectorAll('[data-diff-line-row="true"]');
    fireEvent.click(rows[2]!.children[2]!, { shiftKey: true });

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Single line only' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => {
      expect(onAddComment).toHaveBeenCalledWith(12, 'Single line only', 'const third = 3;', 'new');
    });
  });

  it('keeps a unified range when shift-clicking the comment button', async () => {
    const onAddComment = vi.fn().mockResolvedValue(undefined);
    const { container } = renderWithProviders(
      <DiffChunk
        chunk={testChunk}
        chunkIndex={0}
        threads={[]}
        mode="unified"
        onAddComment={onAddComment}
        onGenerateThreadPrompt={() => ''}
        onRemoveThread={noop}
        onReplyToThread={asyncNoop}
        onRemoveMessage={noop}
        onUpdateMessage={noop}
        filename="src/example.ts"
      />,
    );

    const rows = container.querySelectorAll('[data-diff-line-row="true"]');
    fireEvent.click(rows[0]!);
    fireEvent.mouseEnter(rows[2]!);
    const commentButton = screen.getByRole('button', { name: 'Add a comment' });
    fireEvent.mouseDown(commentButton, { shiftKey: true });
    fireEvent.click(commentButton, { shiftKey: true });

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Please revisit this range' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => {
      expect(onAddComment).toHaveBeenCalledWith(
        [10, 12],
        'Please revisit this range',
        ['const first = 1;', 'const second = 2;', 'const third = 3;'].join('\n'),
        'new',
      );
    });
  });

  it('keeps a split-view range when shift-clicking the comment button', async () => {
    const onAddComment = vi.fn().mockResolvedValue(undefined);
    const { container } = renderWithProviders(
      <SideBySideDiffChunk
        chunk={testChunk}
        chunkIndex={0}
        threads={[]}
        onAddComment={onAddComment}
        onGenerateThreadPrompt={() => ''}
        onRemoveThread={noop}
        onReplyToThread={asyncNoop}
        onRemoveMessage={noop}
        onUpdateMessage={noop}
        filename="src/example.ts"
      />,
    );

    const rows = container.querySelectorAll('[data-diff-line-row="true"]');
    fireEvent.click(rows[0]!.children[2]!);
    fireEvent.mouseEnter(rows[2]!.children[2]!);
    const commentButton = screen.getByRole('button', { name: 'Add a comment' });
    fireEvent.mouseDown(commentButton, { shiftKey: true });
    fireEvent.click(commentButton, { shiftKey: true });

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Please revisit this range' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => {
      expect(onAddComment).toHaveBeenCalledWith(
        [10, 12],
        'Please revisit this range',
        ['const first = 1;', 'const second = 2;', 'const third = 3;'].join('\n'),
        'new',
      );
    });
  });
});

describe('SideBySideDiffChunk fixup overlay', () => {
  const thread: CommentThread = {
    id: 't1',
    file: 'src/example.ts',
    line: 12,
    side: 'new',
    createdAt: '2026-09-18T00:00:00.000Z',
    updatedAt: '2026-09-18T00:00:00.000Z',
    messages: [
      {
        id: 'm1',
        body: 'Explain the constant',
        createdAt: '2026-09-18T00:00:00.000Z',
        updatedAt: '2026-09-18T00:00:00.000Z',
      },
    ],
  };

  const fixup = (sha: string): ThreadFixup => ({
    sha,
    shortSha: sha.slice(0, 7),
    patchId: `patch-${sha}`,
    subject: 'fixup! add third',
    threadIds: ['t1'],
    files: [
      {
        path: 'src/example.ts',
        status: 'modified',
        chunks: [
          {
            header: '@@ -12,1 +12,1 @@',
            oldStart: 12,
            oldLines: 1,
            newStart: 12,
            newLines: 1,
            lines: [
              { type: 'delete', content: 'const third = 3;', oldLineNumber: 12 },
              { type: 'add', content: 'const third = 3; // three', newLineNumber: 12 },
            ],
          },
        ],
      },
    ],
  });

  const renderSplit = (overlay: Partial<FixupOverlayState>, threads = [thread]) =>
    renderWithProviders(
      <FixupOverlayProvider value={{ ...EMPTY_FIXUP_OVERLAY, targetCommit: 'b7c2e10', ...overlay }}>
        <SideBySideDiffChunk
          chunk={testChunk}
          chunkIndex={0}
          threads={threads}
          onAddComment={asyncNoop}
          onGenerateThreadPrompt={() => ''}
          onRemoveThread={noop}
          onReplyToThread={asyncNoop}
          onRemoveMessage={noop}
          onUpdateMessage={noop}
          filename="src/example.ts"
        />
      </FixupOverlayProvider>,
    );

  it('renders the overlay card across both columns below the commented line', () => {
    const { container } = renderSplit({
      enabled: true,
      fixupsByThread: new Map([['t1', [fixup('a'.repeat(40))]]]),
    });

    const card = screen.getByTestId('fixup-overlay-card');
    const cell = card.closest('td');
    expect(cell?.getAttribute('colspan')).toBe('4');

    const rows = [...container.querySelectorAll('table > tbody > tr')];
    const lineRows = container.querySelectorAll('[data-diff-line-row="true"]');
    const commentedRow = lineRows[2]!;
    expect(rows.indexOf(card.closest('tr')!)).toBe(rows.indexOf(commentedRow) + 1);
    expect(card).toHaveTextContent('const third = 3; // three');
    expect(screen.getByTestId('review-state-chip')).toHaveTextContent('승인 대기');
  });

  it('shows no review controls when the target is not a commit', () => {
    renderSplit({
      enabled: true,
      targetCommit: null,
      fixupsByThread: new Map([['t1', [fixup('a'.repeat(40))]]]),
    });

    expect(screen.queryByTestId('review-state-chip')).toBeNull();
    expect(screen.queryByRole('button', { name: '승인' })).toBeNull();
  });

  it('hides the overlay card when overlaying is turned off', () => {
    renderSplit({
      enabled: false,
      fixupsByThread: new Map([['t1', [fixup('a'.repeat(40))]]]),
    });

    expect(screen.queryByTestId('fixup-overlay-card')).toBeNull();
  });

  it('hides the overlay card when the thread has more than one fixup', () => {
    renderSplit({
      enabled: true,
      fixupsByThread: new Map([['t1', [fixup('a'.repeat(40)), fixup('b'.repeat(40))]]]),
    });

    expect(screen.queryByTestId('fixup-overlay-card')).toBeNull();
  });

  it('draws no overlay card under an outdated thread but still shows its review controls', () => {
    renderSplit(
      {
        enabled: true,
        fixupsByThread: new Map([['t1', [fixup('a'.repeat(40))]]]),
      },
      [{ ...thread, isOutdated: true }],
    );

    expect(screen.queryByTestId('fixup-overlay-card')).toBeNull();
    expect(screen.getByRole('button', { name: '승인' })).toBeInTheDocument();
  });
});

describe('DiffChunk fixup overlay', () => {
  const thread: CommentThread = {
    id: 't1',
    file: 'src/example.ts',
    line: 12,
    side: 'new',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    codeContent: 'const third = 3;',
    messages: [
      {
        id: 'm1',
        body: 'Rename this',
        author: 'User',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ],
  };
  const fixup: ThreadFixup = {
    sha: 'abc1234abc1234',
    shortSha: 'abc1234',
    patchId: 'patch-abc1234',
    subject: 'fixup! x',
    threadIds: ['t1'],
    files: [
      {
        path: 'src/example.ts',
        status: 'modified',
        chunks: [
          {
            header: '@@ -12,1 +12,1 @@',
            oldStart: 12,
            oldLines: 1,
            newStart: 12,
            newLines: 1,
            lines: [
              { type: 'delete', content: 'const third = 3;', oldLineNumber: 12 },
              { type: 'add', content: 'const three = 3;', newLineNumber: 12 },
            ],
          },
        ],
      },
    ],
  };

  const renderWithOverlay = (
    threads: CommentThread[],
    fixupsByThread = new Map([['t1', [fixup]]]),
  ) =>
    renderWithProviders(
      <FixupOverlayProvider
        value={{
          ...EMPTY_FIXUP_OVERLAY,
          targetCommit: 'b7c2e10',
          enabled: true,
          fixupsByThread,
        }}
      >
        <DiffChunk
          chunk={testChunk}
          chunkIndex={0}
          threads={threads}
          mode="unified"
          onAddComment={asyncNoop}
          onGenerateThreadPrompt={() => ''}
          onRemoveThread={noop}
          onReplyToThread={asyncNoop}
          onRemoveMessage={noop}
          onUpdateMessage={noop}
          filename="src/example.ts"
        />
      </FixupOverlayProvider>,
    );

  it('draws the overlay card under a located thread', () => {
    renderWithOverlay([thread]);

    expect(screen.getByTestId('fixup-overlay-card')).toBeInTheDocument();
    expect(screen.getByText('Rename this')).toBeInTheDocument();
  });

  it('draws each fixup right above the card of the thread it answers', () => {
    const second: CommentThread = {
      ...thread,
      id: 't2',
      messages: [{ ...thread.messages[0]!, id: 'm2', body: 'Add a comment' }],
    };
    const secondFixup: ThreadFixup = { ...fixup, sha: 'def5678def5678', shortSha: 'def5678' };
    renderWithOverlay(
      [thread, second],
      new Map([
        ['t1', [fixup]],
        ['t2', [secondFixup]],
      ]),
    );

    const order = [
      screen.getByText('abc1234'),
      screen.getByText('Rename this'),
      screen.getByText('def5678'),
      screen.getByText('Add a comment'),
    ];
    order.slice(1).forEach((node, index) => {
      expect(order[index]!.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
    });
  });

  it('names the other files a fixup changed, since the card only draws this file', () => {
    const touchingOthers: ThreadFixup = {
      ...fixup,
      files: [
        ...fixup.files,
        { path: 'src/example.test.ts', status: 'modified', chunks: [] },
        { path: 'src/caller.ts', status: 'modified', chunks: [] },
      ],
    };
    renderWithOverlay([thread], new Map([['t1', [touchingOthers]]]));

    expect(screen.getByTestId('fixup-overlay-card')).toHaveTextContent(
      '다른 파일도 고침: src/example.test.ts, src/caller.ts',
    );
  });

  it('keeps a stale thread card, with its decision buttons, but draws no overlay card', () => {
    renderWithOverlay([{ ...thread, isOutdated: true, outdatedReason: 'missing' }]);

    expect(screen.queryByTestId('fixup-overlay-card')).not.toBeInTheDocument();
    expect(screen.getByText('Rename this')).toBeInTheDocument();
    expect(screen.getByLabelText('Outdated comment')).toHaveTextContent('낡음');
    expect(screen.getByRole('button', { name: '승인' })).toBeInTheDocument();
  });
});
