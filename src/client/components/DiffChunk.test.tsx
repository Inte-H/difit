import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CommentThread, DiffChunk as DiffChunkData, ThreadFixup } from '../../types/diff';
import { DEFAULT_DIFF_VIEW_MODE } from '../../utils/diffMode';
import {
  EMPTY_FIXUP_OVERLAY,
  FixupOverlayProvider,
  type FixupOverlayState,
} from '../contexts/FixupOverlayContext';
import { WordHighlightProvider } from '../contexts/WordHighlightContext';
import { boxesByAnchor, type FixupBox } from '../utils/fixupSpread';
import { symbolRequestFromTarget } from '../utils/symbolPeek';

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
        onResolveThread={noop}
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
        onResolveThread={noop}
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
        onResolveThread={noop}
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
        onResolveThread={noop}
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
        onResolveThread={noop}
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
    authoredAt: '2026-01-01T00:00:00Z',
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
          onResolveThread={noop}
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

  it('labels a fixup that changes only comments, and no other fixup', () => {
    const withKind = (changeKind: 'comment' | 'code'): ThreadFixup => {
      const base = fixup('c'.repeat(40));
      return {
        ...base,
        files: base.files.map((file) => ({
          ...file,
          chunks: file.chunks.map((chunk) => ({ ...chunk, changeKind })),
        })),
      };
    };

    const { unmount } = renderSplit({
      enabled: true,
      fixupsByThread: new Map([['t1', [withKind('comment')]]]),
    });
    const badge = screen.getByTestId('fixup-change-kind');
    expect(badge).toHaveTextContent(/^주석$/);
    expect(badge).toHaveAttribute('title', '코드는 그대로이고 주석만 바뀜');
    unmount();

    renderSplit({ enabled: true, fixupsByThread: new Map([['t1', [withKind('code')]]]) });
    expect(screen.getByTestId('fixup-overlay-card')).toBeInTheDocument();
    expect(screen.queryByTestId('fixup-change-kind')).toBeNull();
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

  it('draws a card for each fixup of the thread in order and approves them together', () => {
    const decideFixups = vi.fn();
    renderSplit({
      enabled: true,
      fixupsByThread: new Map([['t1', [fixup('a'.repeat(40)), fixup('b'.repeat(40))]]]),
      decideFixups,
    });

    const cards = screen.getAllByTestId('fixup-overlay-card');
    expect(cards.map((card) => card.textContent?.slice(0, 7))).toEqual(['aaaaaaa', 'bbbbbbb']);

    fireEvent.click(screen.getByRole('button', { name: '승인' }));
    expect(decideFixups).toHaveBeenCalledWith('t1', 'approved', [
      { fixupSha: 'a'.repeat(40), patchId: `patch-${'a'.repeat(40)}` },
      { fixupSha: 'b'.repeat(40), patchId: `patch-${'b'.repeat(40)}` },
    ]);
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
    authoredAt: '2026-01-01T00:00:00Z',
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
    overlay: Partial<FixupOverlayState> = {},
  ) =>
    renderWithProviders(
      <FixupOverlayProvider
        value={{
          ...EMPTY_FIXUP_OVERLAY,
          targetCommit: 'b7c2e10',
          enabled: true,
          fixupsByThread,
          ...overlay,
        }}
      >
        <DiffChunk
          chunk={testChunk}
          chunkIndex={0}
          threads={threads}
          mode="unified"
          onAddComment={asyncNoop}
          onResolveThread={noop}
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

  const fileChange = (
    file: Partial<ThreadFixup['files'][number]> & { path: string },
    content: string,
  ): ThreadFixup['files'][number] => ({
    status: 'modified',
    chunks: [
      {
        header: '@@ -1,0 +1,1 @@',
        oldStart: 1,
        oldLines: 0,
        newStart: 1,
        newLines: 1,
        lines: [{ type: 'add', content, newLineNumber: 1 }],
      },
    ],
    ...file,
  });

  it('draws only this file in the card and links the other files the fixup changed', () => {
    const touchingOthers: ThreadFixup = {
      ...fixup,
      files: [
        fileChange({ path: 'src/example.test.ts' }, 'expect(three).toBe(3);'),
        ...fixup.files,
        fileChange({ path: 'src/caller.ts' }, 'use(three);'),
      ],
    };
    const revealFixupFile = vi.fn();
    renderWithOverlay([thread], new Map([['t1', [touchingOthers]]]), { revealFixupFile });

    const card = screen.getByTestId('fixup-overlay-card');
    expect(card).toHaveTextContent('const three = 3;');
    expect(card).not.toHaveTextContent('expect(three).toBe(3);');
    expect(card).not.toHaveTextContent('use(three);');
    expect(card).toHaveTextContent(
      /이 fixup에서 수정한 다른 파일:\s*src\/example\.test\.ts\s*src\/caller\.ts/,
    );

    fireEvent.click(within(card).getByRole('button', { name: 'src/caller.ts' }));

    expect(revealFixupFile).toHaveBeenCalledWith('abc1234abc1234', 'src/caller.ts');
  });

  it('marks another file the fixup renamed, added or deleted', () => {
    const touchingOthers: ThreadFixup = {
      ...fixup,
      files: [
        ...fixup.files,
        fileChange({ path: 'src/three.ts', oldPath: 'src/third.ts', status: 'renamed' }, 'a'),
        fileChange({ path: 'src/new.ts', status: 'added' }, 'b'),
        fileChange({ path: 'src/gone.ts', status: 'deleted' }, 'c'),
      ],
    };
    renderWithOverlay([thread], new Map([['t1', [touchingOthers]]]));

    const card = screen.getByTestId('fixup-overlay-card');
    expect(card).toHaveTextContent('src/third.ts → src/three.ts');
    expect(card).toHaveTextContent(/src\/new\.ts\s*새 파일/);
    expect(card).toHaveTextContent(/src\/gone\.ts\s*지운 파일/);
  });

  it('links a generated file the fixup changed without drawing its changes', () => {
    const touchingLockfile: ThreadFixup = {
      ...fixup,
      files: [
        ...fixup.files,
        fileChange({ path: 'pnpm-lock.yaml', isGenerated: true }, 'lockfileVersion: 9'),
      ],
    };
    const revealFixupFile = vi.fn();
    renderWithOverlay([thread], new Map([['t1', [touchingLockfile]]]), { revealFixupFile });

    const card = screen.getByTestId('fixup-overlay-card');
    expect(card).toHaveTextContent(/pnpm-lock\.yaml\s*생성된 파일/);
    expect(card).not.toHaveTextContent('lockfileVersion: 9');

    fireEvent.click(within(card).getByRole('button', { name: 'pnpm-lock.yaml' }));

    expect(revealFixupFile).toHaveBeenCalledWith('abc1234abc1234', 'pnpm-lock.yaml');
  });

  it('draws a file an earlier fixup renamed on the card of a thread on its reviewed path', () => {
    const onRenamed: ThreadFixup = {
      ...fixup,
      files: [fileChange({ path: 'src/renamed.ts' }, 'const three = 3;')],
    };
    renderWithOverlay([thread], new Map([['t1', [onRenamed]]]), {
      fixupReviewPaths: new Map([['abc1234abc1234:src/renamed.ts', 'src/example.ts']]),
    });

    const card = screen.getByTestId('fixup-overlay-card');
    expect(card).toHaveTextContent('const three = 3;');
    expect(card).not.toHaveTextContent('이 fixup에서 수정한 다른 파일');
  });

  it('lists no other files on a fixup that changed only this file', () => {
    renderWithOverlay([thread]);

    const card = screen.getByTestId('fixup-overlay-card');
    expect(card).not.toHaveTextContent('이 fixup에서 수정한 다른 파일');
    expect(within(card).queryByRole('button')).not.toBeInTheDocument();
  });

  it('keeps a stale thread card, with its decision buttons, but draws no overlay card', () => {
    renderWithOverlay([{ ...thread, isOutdated: true, outdatedReason: 'missing' }]);

    expect(screen.queryByTestId('fixup-overlay-card')).not.toBeInTheDocument();
    expect(screen.getByText('Rename this')).toBeInTheDocument();
    expect(screen.getByLabelText('Outdated comment')).toHaveTextContent('낡음');
    expect(screen.getByRole('button', { name: '승인' })).toBeInTheDocument();
  });
});

describe('fixup boxes in a file the comment is not on', () => {
  const answered = { id: 't1', file: 'src/example.ts', line: 12 };
  const callerFixup: ThreadFixup = {
    sha: 'abc1234abc1234',
    shortSha: 'abc1234',
    patchId: 'patch-abc1234',
    authoredAt: '2026-01-01T00:00:00Z',
    subject: 'fixup! x',
    threadIds: ['t1'],
    files: [],
  };
  const box = (overrides: Partial<FixupBox> = {}): FixupBox => {
    const file: FixupBox['file'] = {
      path: 'src/caller.ts',
      status: 'modified',
      chunks: [
        {
          header: '@@ -11,1 +11,1 @@',
          oldStart: 11,
          oldLines: 1,
          newStart: 11,
          newLines: 1,
          lines: [
            { type: 'delete', content: 'const second = 2;', oldLineNumber: 11 },
            { type: 'add', content: 'const second = three - 1;', newLineNumber: 11 },
          ],
        },
      ],
    };
    return {
      fixup: { ...callerFixup, files: [file] },
      threads: [answered],
      file,
      chunk: file.chunks[0]!,
      chunkIndex: 0,
      anchor: 11,
      ...overrides,
    };
  };

  const boxesView = (
    mode: 'unified' | 'split',
    boxes: FixupBox[],
    overlay: Partial<FixupOverlayState> = {},
    chunk: DiffChunkData = testChunk,
  ) => (
    <WordHighlightProvider>
      <FixupOverlayProvider
        value={{
          ...EMPTY_FIXUP_OVERLAY,
          targetCommit: 'b7c2e10',
          enabled: true,
          boxesByFile: new Map([['src/caller.ts', boxesByAnchor(boxes)]]),
          ...overlay,
        }}
      >
        <DiffChunk
          chunk={chunk}
          chunkIndex={0}
          threads={[]}
          mode={mode}
          onAddComment={asyncNoop}
          onResolveThread={noop}
          onReplyToThread={asyncNoop}
          onRemoveMessage={noop}
          onUpdateMessage={noop}
          filename="src/caller.ts"
        />
      </FixupOverlayProvider>
    </WordHighlightProvider>
  );
  const renderBoxes = (...args: Parameters<typeof boxesView>) => render(boxesView(...args));

  describe.each(['unified', 'split'] as const)('in the %s view', (mode) => {
    it('draws the box across the row right below the line the fixup changed', () => {
      const { container } = renderBoxes(mode, [box()]);

      const fileBox = screen.getByTestId('fixup-file-box');
      const boxRow = fileBox.closest('tr')!;
      expect(boxRow.querySelector('td')?.getAttribute('colspan')).toBe(
        mode === 'unified' ? '3' : '4',
      );
      const rows = [...container.querySelectorAll('table > tbody > tr')];
      const second = container.querySelectorAll('[data-diff-line-row="true"]')[1]!;
      expect(second).toHaveTextContent('const second = 2;');
      expect(rows.indexOf(boxRow)).toBe(rows.indexOf(second) + 1);
      expect(fileBox).toHaveTextContent('const second = three - 1;');
    });

    it('names and links the comment it answers, and offers no decision', () => {
      const pickThread = vi.fn();
      renderBoxes(mode, [box()], { pickThread });

      const fileBox = screen.getByTestId('fixup-file-box');
      expect(fileBox).toHaveTextContent(
        'abc1234 · 지적 src/example.ts:12를 고치며 함께 수정함 · 승인과 거절은 그 지적 카드에서',
      );
      expect(within(fileBox).queryByRole('button', { name: '승인' })).toBeNull();
      expect(within(fileBox).queryByRole('button', { name: '거절' })).toBeNull();

      fireEvent.click(within(fileBox).getByRole('button', { name: 'src/example.ts:12' }));

      expect(pickThread).toHaveBeenCalledWith('t1');
    });

    it('links every comment one fixup answers', () => {
      const pickThread = vi.fn();
      renderBoxes(
        mode,
        [box({ threads: [answered, { id: 't2', file: 'src/other.ts', line: [3, 5] }] })],
        { pickThread },
      );

      const fileBox = screen.getByTestId('fixup-file-box');
      expect(fileBox).toHaveTextContent('지적 src/example.ts:12, src/other.ts:3-5를 고치며');

      fireEvent.click(within(fileBox).getByRole('button', { name: 'src/other.ts:3-5' }));

      expect(pickThread).toHaveBeenCalledWith('t2');
    });

    it('draws a box once under a line that was replaced', () => {
      const replaced: DiffChunkData = {
        ...testChunk,
        lines: [
          { type: 'delete', content: 'const old = 0;', oldLineNumber: 11 },
          { type: 'add', content: 'const second = 2;', newLineNumber: 11 },
        ],
      };
      renderBoxes(mode, [box()], {}, replaced);

      expect(screen.getAllByTestId('fixup-file-box')).toHaveLength(1);
    });

    it('draws no box under a line no fixup changed', () => {
      renderBoxes(mode, [box({ anchor: 30 })]);

      expect(screen.queryByTestId('fixup-file-box')).toBeNull();
    });

    it('keeps a generated file folded until it is opened', () => {
      const generated = box();
      const file = { ...generated.file, isGenerated: true };
      renderBoxes(mode, [{ ...generated, file }]);

      const fileBox = screen.getByTestId('fixup-file-box');
      expect(fileBox).toHaveTextContent('생성된 파일');
      expect(fileBox).not.toHaveTextContent('const second = three - 1;');

      fireEvent.click(within(fileBox).getByRole('button', { name: '펼치기' }));

      expect(fileBox).toHaveTextContent('const second = three - 1;');
    });

    it('highlights the box of the focused fixup file and opens it', () => {
      const generated = box();
      const file = { ...generated.file, isGenerated: true };
      const shownBox = { ...generated, file };
      const focusOn = (path: string) => ({
        focusedFixupFile: { fixupSha: callerFixup.sha, path },
      });
      const { rerender } = renderBoxes(mode, [shownBox], focusOn('src/elsewhere.ts'));
      expect(screen.getByTestId('fixup-file-box')).not.toHaveClass('border-github-accent');

      rerender(boxesView(mode, [shownBox], focusOn('src/caller.ts')));

      const fileBox = screen.getByTestId('fixup-file-box');
      expect(fileBox).toHaveClass('border-github-accent');
      expect(fileBox).toHaveTextContent('const second = three - 1;');
    });
  });
});

describe('editing the reviewed code directly', () => {
  const comment = (overrides: Partial<CommentThread> = {}): CommentThread => ({
    id: 'c1',
    file: 'src/example.ts',
    line: 11,
    side: 'new',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    codeContent: 'const second = 2;',
    messages: [
      {
        id: 'm1',
        body: 'Drop this',
        author: 'User',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ],
    ...overrides,
  });

  function renderEditable({
    mode = 'unified',
    threads = [],
    overlay = {},
  }: {
    mode?: 'unified' | 'split';
    threads?: CommentThread[];
    overlay?: Partial<FixupOverlayState>;
  } = {}) {
    const submit = vi.fn().mockResolvedValue(null);
    const value: FixupOverlayState = {
      ...EMPTY_FIXUP_OVERLAY,
      targetCommit: 'b7c2e10',
      directEdit: { commit: 'b7c2e10', submit },
      ...overlay,
    };
    const blob = new TextEncoder().encode(
      `${'// filler\n'.repeat(9)}const first = 1;\nconst second = 2;\nconst third = 3;\n`,
    );
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      arrayBuffer: async () => blob.slice().buffer,
    } as Response);
    const props = {
      chunk: testChunk,
      chunkIndex: 0,
      threads,
      onAddComment: asyncNoop,
      onResolveThread: noop,
      onReplyToThread: asyncNoop,
      onRemoveMessage: noop,
      onUpdateMessage: noop,
      filename: 'src/example.ts',
    };
    const view = renderWithProviders(
      <FixupOverlayProvider value={value}>
        {mode === 'unified' ? (
          <DiffChunk {...props} mode="unified" />
        ) : (
          <SideBySideDiffChunk {...props} />
        )}
      </FixupOverlayProvider>,
    );
    const rows = view.container.querySelectorAll('[data-diff-line-row="true"]');
    const hover = (index: number) =>
      fireEvent.mouseEnter(mode === 'unified' ? rows[index]! : rows[index]!.children[2]!);
    return { ...view, submit, hover };
  }

  const commitEdit = async (text: string) => {
    fireEvent.change(await screen.findByLabelText('고칠 코드'), { target: { value: text } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
  };

  it('edits only the line whose pencil was pressed, even with shift held', async () => {
    const { submit, hover } = renderEditable();

    hover(0);
    fireEvent.click(screen.getByRole('button', { name: '줄 직접 고치기' }));
    hover(2);
    fireEvent.click(screen.getByRole('button', { name: '줄 직접 고치기' }), { shiftKey: true });

    expect(await screen.findByLabelText('고칠 코드')).toHaveValue('const third = 3;');
    await commitEdit('const third = 30;');
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith(
        expect.objectContaining({ startLine: 12, endLine: 12, replacement: ['const third = 30;'] }),
      ),
    );
  });

  it('edits the picked lines from the selection bar', async () => {
    const { submit, container } = renderEditable();
    const rows = container.querySelectorAll('[data-diff-line-row="true"]');

    selectText([codeCell('unified', rows[0]!), 'first'], [codeCell('unified', rows[2]!), 'third']);
    fireEvent.click(await screen.findByRole('button', { name: '직접 고치기' }));
    document.getSelection()?.removeAllRanges();

    expect(await screen.findByLabelText('고칠 코드')).toHaveValue(
      ['const first = 1;', 'const second = 2;', 'const third = 3;'].join('\n'),
    );
    await commitEdit('const first = 1;');
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith(
        expect.objectContaining({
          filePath: 'src/example.ts',
          startLine: 10,
          endLine: 12,
          replacement: ['const first = 1;'],
        }),
      ),
    );
    expect(submit.mock.calls[0]?.[0]).not.toHaveProperty('threadId');
  });

  it('edits the lines of the new side in the split view', async () => {
    const { submit, hover } = renderEditable({ mode: 'split' });

    hover(1);
    fireEvent.click(screen.getByRole('button', { name: '줄 직접 고치기' }));
    await screen.findByLabelText('고칠 코드');
    fireEvent.click(screen.getByRole('button', { name: '줄 지우기' }));

    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith(
        expect.objectContaining({ startLine: 11, endLine: 11, replacement: [] }),
      ),
    );
  });

  it('edits the whole hunk from its button', async () => {
    renderEditable();

    fireEvent.click(screen.getByRole('button', { name: 'hunk 고치기' }));

    expect(await screen.findByLabelText('고칠 코드')).toHaveValue(
      ['const first = 1;', 'const second = 2;', 'const third = 3;'].join('\n'),
    );
  });

  it('answers the one waiting comment on the edited lines', async () => {
    const { submit, hover } = renderEditable({ threads: [comment()] });

    hover(1);
    fireEvent.click(screen.getByRole('button', { name: '줄 직접 고치기' }));
    expect(screen.getByText('이 줄의 지적에 대한 답으로 저장합니다')).toBeInTheDocument();
    await commitEdit('');

    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith(expect.objectContaining({ threadId: 'c1' })),
    );
  });

  it('offers to edit from a waiting comment but not from one an edit opened', async () => {
    const { rerender } = renderEditable({ threads: [comment()] });
    fireEvent.click(screen.getByRole('button', { name: '직접 고치기' }));
    expect(await screen.findByLabelText('고칠 코드')).toHaveValue('const second = 2;');

    rerender(
      <WordHighlightProvider>
        <FixupOverlayProvider
          value={{
            ...EMPTY_FIXUP_OVERLAY,
            targetCommit: 'b7c2e10',
            directEdit: { commit: 'b7c2e10', submit: vi.fn() },
          }}
        >
          <DiffChunk
            chunk={testChunk}
            chunkIndex={0}
            threads={[
              comment({
                id: 'e1',
                messages: [{ ...comment().messages[0]!, author: 'reviewer-edit' }],
              }),
            ]}
            mode="unified"
            onAddComment={asyncNoop}
            onResolveThread={noop}
            onReplyToThread={asyncNoop}
            onRemoveMessage={noop}
            onUpdateMessage={noop}
            filename="src/example.ts"
          />
        </FixupOverlayProvider>
      </WordHighlightProvider>,
    );
    expect(screen.queryByRole('button', { name: '직접 고치기' })).not.toBeInTheDocument();
  });

  it('reverts an approved edit, replied to or not, by rejecting it', () => {
    const decideFixups = vi.fn();
    const answered = comment({
      messages: [
        ...comment().messages,
        {
          id: 'm2',
          body: '직접 고침',
          author: 'reviewer-edit',
          createdAt: '2026-01-02T00:00:00Z',
          updatedAt: '2026-01-02T00:00:00Z',
        },
        {
          id: 'm3',
          body: 'Looks better',
          author: 'User',
          createdAt: '2026-01-03T00:00:00Z',
          updatedAt: '2026-01-03T00:00:00Z',
        },
      ],
    });
    const fixup: ThreadFixup = {
      sha: 'e'.repeat(40),
      shortSha: 'eeeeeee',
      patchId: 'patch-e',
      authoredAt: '2026-01-01T00:00:00Z',
      subject: 'fixup! x',
      threadIds: ['c1'],
      files: [],
    };
    renderEditable({
      threads: [answered],
      overlay: {
        decideFixups,
        fixupsByThread: new Map([['c1', [fixup]]]),
        decisions: [
          { threadId: 'c1', kind: 'approved', fixupSha: fixup.sha, at: '2026-01-02T00:00:00Z' },
        ],
      },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Expand thread' }));
    expect(screen.getByRole('button', { name: '승인 취소' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '되돌리기' }));

    expect(decideFixups).toHaveBeenCalledWith('c1', 'rejected', [
      { fixupSha: fixup.sha, patchId: 'patch-e' },
    ]);
  });

  it('shows no pencil when the review cannot take edits', () => {
    const { hover } = renderEditable({ overlay: { directEdit: null } });

    hover(0);

    expect(screen.queryByRole('button', { name: '줄 직접 고치기' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'hunk 고치기' })).not.toBeInTheDocument();
  });
});

type ChunkMode = 'unified' | 'split';

function renderChunk(
  mode: ChunkMode,
  {
    commentable = true,
    ...extra
  }: {
    onOpenInEditor?: () => void;
    commentable?: boolean;
    commentTrigger?: { fileIndex: number; chunkIndex: number; lineIndex: number };
  } = {},
) {
  const onAddComment = vi.fn().mockResolvedValue(undefined);
  const props = {
    chunk: testChunk,
    chunkIndex: 0,
    threads: [],
    ...(commentable ? { onAddComment } : {}),
    onResolveThread: noop,
    onReplyToThread: asyncNoop,
    onRemoveMessage: noop,
    onUpdateMessage: noop,
    filename: 'src/example.ts',
    ...extra,
  };
  const view = renderWithProviders(
    mode === 'unified' ? (
      <DiffChunk {...props} mode="unified" />
    ) : (
      <SideBySideDiffChunk {...props} />
    ),
  );
  const rows = Array.from(view.container.querySelectorAll('[data-diff-line-row="true"]'));
  return { onAddComment, rows };
}

// Unified rows are old number, new number, code; split rows are old number, old code, new number,
// new code.
const codeCell = (mode: ChunkMode, row: Element) => row.children[mode === 'unified' ? 2 : 3]!;
const lineNumberCell = (mode: ChunkMode, row: Element) => row.children[mode === 'unified' ? 0 : 2]!;

function textPoint(cell: Element, text: string): [Text, number] {
  const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const index = node.textContent?.indexOf(text) ?? -1;
    if (index !== -1) return [node as Text, index];
  }
  throw new Error(`no "${text}" in the cell`);
}

function selectText(from: [Element, string], to: [Element, string]) {
  const [startNode, startOffset] = textPoint(...from);
  const [endNode, endIndex] = textPoint(...to);
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endIndex + to[1].length);
  const selection = document.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
}

describe.each<ChunkMode>(['unified', 'split'])('commenting on picked code (%s)', (mode) => {
  afterEach(() => {
    document.getSelection()?.removeAllRanges();
  });

  it('hands over the picked text together with the lines it spans', async () => {
    const { onAddComment, rows } = renderChunk(mode);

    selectText([codeCell(mode, rows[0]!), 'first'], [codeCell(mode, rows[1]!), 'second']);
    fireEvent.click(await screen.findByRole('button', { name: '고른 부분에 지적 달기' }));

    expect(screen.getByLabelText('고른 부분')).toHaveTextContent('first = 1; const second');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Why two lines?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    const body = '> first = 1;\n> const second\n\nWhy two lines?';
    await waitFor(() => {
      expect(onAddComment).toHaveBeenCalledWith(
        [10, 11],
        body,
        ['const first = 1;', 'const second = 2;'].join('\n'),
        'new',
      );
    });
  });

  it('comments on the whole lines dragged over in the line numbers', async () => {
    const { onAddComment, rows } = renderChunk(mode);

    fireEvent.mouseDown(lineNumberCell(mode, rows[0]!));
    fireEvent.mouseMove(codeCell(mode, rows[2]!));
    fireEvent.mouseUp(document);

    fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'All three' } });
    expect(screen.queryByLabelText('고른 부분')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => {
      expect(onAddComment).toHaveBeenCalledWith(
        [10, 12],
        'All three',
        ['const first = 1;', 'const second = 2;', 'const third = 3;'].join('\n'),
        'new',
      );
    });
  });

  it('opens no comment for a click on a line number', async () => {
    const { rows } = renderChunk(mode);

    fireEvent.mouseDown(lineNumberCell(mode, rows[1]!));
    fireEvent.mouseUp(document);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});

it('moves the bar to the chunk the selection moves to', async () => {
  const props = {
    threads: [],
    onAddComment: asyncNoop,
    onResolveThread: noop,
    onReplyToThread: asyncNoop,
    onRemoveMessage: noop,
    onUpdateMessage: noop,
    filename: 'src/example.ts',
    mode: 'unified' as const,
  };
  const later: DiffChunkData = {
    ...testChunk,
    header: '@@ -40,3 +40,3 @@',
    lines: testChunk.lines.map((line) => ({
      ...line,
      content: line.content.replace('const', 'let'),
      oldLineNumber: line.oldLineNumber && line.oldLineNumber + 30,
      newLineNumber: line.newLineNumber && line.newLineNumber + 30,
    })),
  };
  const { container } = renderWithProviders(
    <>
      <DiffChunk {...props} chunk={testChunk} chunkIndex={0} />
      <DiffChunk {...props} chunk={later} chunkIndex={1} />
    </>,
  );
  const rows = Array.from(container.querySelectorAll('[data-diff-line-row="true"]'));

  selectText([codeCell('unified', rows[0]!), 'first'], [codeCell('unified', rows[0]!), 'first']);
  await screen.findByRole('button', { name: '고른 부분에 지적 달기' });
  selectText([codeCell('unified', rows[4]!), 'second'], [codeCell('unified', rows[4]!), 'second']);
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(screen.getAllByRole('button', { name: '고른 부분에 지적 달기' })).toHaveLength(1);

  fireEvent.click(screen.getByRole('button', { name: '고른 부분에 지적 달기' }));
  expect(rows[4]!.closest('table')).toContainElement(screen.getByRole('textbox'));
  expect(screen.getByLabelText('고른 부분')).toHaveTextContent('second');
  document.getSelection()?.removeAllRanges();
});

describe('line buttons by input device', () => {
  const originalMatchMedia = window.matchMedia;

  const pointerCanHover = (canHover: boolean) => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query === '(hover: hover)' ? canHover : false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
  };

  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: originalMatchMedia,
    });
  });

  it.each<ChunkMode>(['unified', 'split'])(
    'puts the comment button on the line number and the others at the end of the line with a mouse (%s)',
    (mode) => {
      pointerCanHover(true);
      const { rows } = renderChunk(mode, { onOpenInEditor: noop });
      const row = rows[2]!;

      fireEvent.mouseEnter(mode === 'unified' ? row : codeCell(mode, row));

      const numberCell = row.children[mode === 'unified' ? 1 : 2]!;
      expect(numberCell).toContainElement(screen.getByRole('button', { name: 'Add a comment' }));
      expect(codeCell(mode, row)).toContainElement(screen.getByTitle('Open in editor'));
      expect(screen.queryByRole('button', { name: '줄 메뉴' })).not.toBeInTheDocument();
    },
  );

  it.each<ChunkMode>(['unified', 'split'])(
    'opens every line action from one button on the line number on a touch screen (%s)',
    async (mode) => {
      pointerCanHover(false);
      const onOpenInEditor = vi.fn();
      const { rows } = renderChunk(mode, { onOpenInEditor });
      const row = rows[2]!;

      fireEvent.mouseEnter(mode === 'unified' ? row : codeCell(mode, row));

      expect(screen.queryByRole('button', { name: 'Add a comment' })).not.toBeInTheDocument();
      expect(screen.queryByTitle('Open in editor')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '줄 메뉴' }));
      fireEvent.click(await screen.findByRole('menuitem', { name: '에디터에서 열기' }));
      expect(onOpenInEditor).toHaveBeenCalledWith('src/example.ts', 12);

      fireEvent.click(screen.getByRole('button', { name: '줄 메뉴' }));
      fireEvent.click(await screen.findByRole('menuitem', { name: '지적 달기' }));
      expect(screen.getByRole('textbox')).toBeInTheDocument();
    },
  );
});

describe.each<ChunkMode>(['unified', 'split'])('a view that takes no comments (%s)', (mode) => {
  const originalMatchMedia = window.matchMedia;
  const pointerCanHover = (canHover: boolean) => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query === '(hover: hover)' ? canHover : false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
  };

  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: originalMatchMedia,
    });
    document.getSelection()?.removeAllRanges();
  });

  it('shows no comment button on a hovered line', () => {
    pointerCanHover(true);
    const { rows } = renderChunk(mode, { commentable: false, onOpenInEditor: noop });

    fireEvent.mouseEnter(mode === 'unified' ? rows[2]! : codeCell(mode, rows[2]!));

    expect(screen.queryByRole('button', { name: 'Add a comment' })).not.toBeInTheDocument();
    expect(screen.getByTitle('Open in editor')).toBeInTheDocument();
  });

  it('leaves commenting out of the line menu on a touch screen', async () => {
    pointerCanHover(false);
    const { rows } = renderChunk(mode, { commentable: false, onOpenInEditor: noop });

    fireEvent.mouseEnter(mode === 'unified' ? rows[2]! : codeCell(mode, rows[2]!));
    fireEvent.click(screen.getByRole('button', { name: '줄 메뉴' }));

    expect(await screen.findByRole('menuitem', { name: '에디터에서 열기' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: '지적 달기' })).not.toBeInTheDocument();
  });

  it('shows no line button on a touch screen when nothing else is on offer', () => {
    pointerCanHover(false);
    const { rows } = renderChunk(mode, { commentable: false });

    fireEvent.mouseEnter(mode === 'unified' ? rows[2]! : codeCell(mode, rows[2]!));

    expect(screen.queryByRole('button', { name: '줄 메뉴' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add a comment' })).not.toBeInTheDocument();
  });

  it('opens no comment for lines dragged over, picked text or the comment key', async () => {
    const { rows } = renderChunk(mode, {
      commentable: false,
      commentTrigger: { fileIndex: 0, chunkIndex: 0, lineIndex: 2 },
    });

    fireEvent.mouseDown(lineNumberCell(mode, rows[0]!));
    fireEvent.mouseMove(codeCell(mode, rows[2]!));
    fireEvent.mouseUp(document);
    selectText([codeCell(mode, rows[0]!), 'first'], [codeCell(mode, rows[1]!), 'second']);
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '고른 부분에 지적 달기' })).not.toBeInTheDocument();
  });
});

describe('DiffChunk symbol positions', () => {
  const emojiLine = 'String 표시 = "😀" + name;';
  const oldLine = '        return port.findById(id).orElse(null);';
  const newLine = '        return port.findById(id).orElse(cache.findById(id));';
  const javaChunk: DiffChunkData = {
    header: '@@ -10,2 +10,2 @@',
    oldStart: 10,
    oldLines: 2,
    newStart: 10,
    newLines: 2,
    lines: [
      { type: 'normal', content: emojiLine, oldLineNumber: 10, newLineNumber: 10 },
      { type: 'delete', content: oldLine, oldLineNumber: 11 },
      { type: 'add', content: newLine, newLineNumber: 11 },
    ],
  };
  const refs = { base: 'base111', target: 'target2' };

  async function wordsIn(side: 'old' | 'new', line: number, word: string) {
    return waitFor(() => {
      const row = document.querySelector(
        `[data-symbol-side="${side}"][data-symbol-line="${line}"]`,
      );
      expect(row?.querySelector('.token:not(.plain)')).toBeTruthy();
      const found = Array.from(row!.querySelectorAll(`.word-token[data-word="${word}"]`));
      expect(found.length).toBeGreaterThan(0);
      return found;
    });
  }

  describe.each(['unified', 'split'] as const)('in the %s view', (mode) => {
    it('sends the line and the column of each clicked name', async () => {
      renderWithProviders(
        <DiffChunk
          chunk={javaChunk}
          chunkIndex={0}
          threads={[]}
          mode={mode}
          onAddComment={asyncNoop}
          onResolveThread={noop}
          onReplyToThread={asyncNoop}
          onRemoveMessage={noop}
          onUpdateMessage={noop}
          filename="src/Service.java"
        />,
      );

      const twoOnOneLine = await wordsIn('new', 11, 'findById');
      expect(document.querySelector('.word-diff-added')).not.toBeNull();
      expect(twoOnOneLine.map((word) => symbolRequestFromTarget(word, refs))).toEqual([
        {
          name: 'findById',
          ref: 'target2',
          from: 'src/Service.java',
          line: 11,
          column: newLine.indexOf('findById'),
        },
        {
          name: 'findById',
          ref: 'target2',
          from: 'src/Service.java',
          line: 11,
          column: newLine.lastIndexOf('findById'),
        },
      ]);

      const [deleted] = await wordsIn('old', 11, 'orElse');
      expect(symbolRequestFromTarget(deleted!, refs)).toMatchObject({
        ref: 'base111',
        line: 11,
        column: oldLine.indexOf('orElse'),
      });

      // Columns count UTF-16 code units, as the index does.
      const [afterEmoji] = await wordsIn('new', 10, 'name');
      expect(symbolRequestFromTarget(afterEmoji!, refs)).toMatchObject({
        line: 10,
        column: emojiLine.indexOf('name'),
      });
      expect(emojiLine.indexOf('name')).toBe(19);
    });
  });
});

describe('syntax colors on lines with changed parts marked', () => {
  const enumChunk: DiffChunkData = {
    header: '@@ -1,2 +1,3 @@',
    oldStart: 1,
    oldLines: 2,
    newStart: 1,
    newLines: 3,
    lines: [
      { type: 'normal', content: '    BAR("bar"),', oldLineNumber: 1, newLineNumber: 1 },
      { type: 'delete', content: '    BAZ("baz");', oldLineNumber: 2 },
      { type: 'add', content: '    BAZ("baz"),', newLineNumber: 2 },
      { type: 'add', content: '    QUX("qux");', newLineNumber: 3 },
    ],
  };

  const lineOf = (side: 'old' | 'new', line: number) =>
    document.querySelector<HTMLElement>(`[data-symbol-side="${side}"][data-symbol-line="${line}"]`);

  describe.each(['unified', 'split'] as const)('in the %s view', (mode) => {
    it.each(['vsDark', 'github'] as const)(
      'colors both BAZ lines like the unchanged line, with %s',
      async (syntaxTheme) => {
        renderWithProviders(
          <DiffChunk
            chunk={enumChunk}
            chunkIndex={0}
            threads={[]}
            mode={mode}
            onAddComment={asyncNoop}
            onResolveThread={noop}
            onReplyToThread={asyncNoop}
            onRemoveMessage={noop}
            onUpdateMessage={noop}
            filename="src/Kind.java"
            syntaxTheme={syntaxTheme}
          />,
        );

        const barString = await waitFor(() => {
          const found = lineOf('new', 1)?.querySelector<HTMLElement>('.token.string');
          expect(found).toBeTruthy();
          return found!;
        });
        const barNameToken = lineOf('new', 1)!
          .querySelector('.word-token[data-word="BAR"]')!
          .closest<HTMLElement>('.token')!;
        expect(barNameToken.className).not.toContain('plain');

        const cases = [
          { side: 'old', mark: '.word-diff-removed', changed: ';' },
          { side: 'new', mark: '.word-diff-added', changed: ',' },
        ] as const;
        for (const { side, mark, changed } of cases) {
          const bazString = await waitFor(() => {
            const found = lineOf(side, 2)?.querySelector<HTMLElement>('.token.string');
            expect(found?.textContent).toBe('"baz"');
            return found!;
          });
          expect(bazString.style.color).toBe(barString.style.color);
          expect(bazString.style.color).not.toBe('');

          const line = lineOf(side, 2)!;
          expect(line.textContent).toContain(side === 'old' ? 'BAZ("baz");' : 'BAZ("baz"),');

          const changedPart = line.querySelector(mark);
          expect(changedPart?.textContent).toBe(changed);
          expect(changedPart?.querySelector('.token.punctuation')?.textContent).toBe(changed);

          const name = line.querySelector('.word-token[data-word="BAZ"]');
          const nameToken = name?.closest<HTMLElement>('.token');
          expect(nameToken?.className).toBe(barNameToken.className);
          expect(nameToken?.style.color).toBe(barNameToken.style.color);
          expect(symbolRequestFromTarget(name, { base: 'b', target: 't' })).toMatchObject({
            name: 'BAZ',
            line: 2,
            column: 4,
          });
        }
      },
    );
  });
});

describe.each<ChunkMode>(['unified', 'split'])('names clicked in fixup code (%s)', (mode) => {
  const sha = 'abc1234abc1234';
  const refs = { base: 'base111', target: 'target2' };
  const thread: CommentThread = {
    id: 't1',
    file: 'src/example.ts',
    line: 12,
    side: 'new',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    codeContent: 'const third = 3;',
    messages: [],
  };
  const changed = (file: { path: string; oldPath?: string }): ThreadFixup['files'][number] => ({
    status: file.oldPath ? 'renamed' : 'modified',
    ...file,
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
  });
  const fixupOf = (files: ThreadFixup['files']): ThreadFixup => ({
    sha,
    shortSha: 'abc1234',
    patchId: 'patch-abc1234',
    authoredAt: '2026-01-01T00:00:00Z',
    subject: 'fixup! x',
    threadIds: ['t1'],
    files,
  });

  const renderCard = (
    fixup: ThreadFixup,
    overlay: Partial<FixupOverlayState> = {},
    wrap: (ui: ReactNode) => ReactNode = (ui) => ui,
  ) =>
    renderWithProviders(
      wrap(
        <FixupOverlayProvider
          value={{
            ...EMPTY_FIXUP_OVERLAY,
            targetCommit: 'b7c2e10',
            enabled: true,
            fixupsByThread: new Map([['t1', [fixup]]]),
            ...overlay,
          }}
        >
          <DiffChunk
            chunk={testChunk}
            chunkIndex={0}
            threads={[thread]}
            mode={mode}
            onAddComment={asyncNoop}
            onResolveThread={noop}
            onReplyToThread={asyncNoop}
            onRemoveMessage={noop}
            onUpdateMessage={noop}
            filename="src/example.ts"
          />
        </FixupOverlayProvider>,
      ),
    );

  async function clicked(scope: Element, word: string) {
    const token = await waitFor(() => {
      const found = scope.querySelector(`.word-token[data-word="${word}"]`);
      expect(found).not.toBeNull();
      return found!;
    });
    return symbolRequestFromTarget(token, refs);
  }

  it('looks a name up in the fixup commit, and on a deleted line in its parent', async () => {
    renderCard(fixupOf([changed({ path: 'src/example.ts' })]));

    const card = screen.getByTestId('fixup-overlay-card');
    expect(await clicked(card, 'three')).toEqual({
      name: 'three',
      ref: sha,
      from: 'src/example.ts',
      line: 12,
      column: 6,
    });
    expect(await clicked(card, 'third')).toEqual({
      name: 'third',
      ref: `${sha}^`,
      from: 'src/example.ts',
      line: 12,
      column: 6,
    });
  });

  it('looks a deleted line of a renamed file up under its old path', async () => {
    renderCard(fixupOf([changed({ path: 'src/renamed.ts', oldPath: 'src/example.ts' })]));

    const card = screen.getByTestId('fixup-overlay-card');
    expect(await clicked(card, 'three')).toMatchObject({ ref: sha, from: 'src/renamed.ts' });
    expect(await clicked(card, 'third')).toMatchObject({
      ref: `${sha}^`,
      from: 'src/example.ts',
      line: 12,
    });
  });

  it('looks a name up in a file the card holds for another path', async () => {
    renderCard(fixupOf([changed({ path: 'src/example.ts' }), changed({ path: 'src/held.ts' })]), {
      fixupPlaces: new Map([[`${sha}:src/held.ts`, { kind: 'card', threadId: 't1' }]]),
    });

    const held = screen.getByText('src/held.ts').parentElement!;
    expect(await clicked(held, 'three')).toEqual({
      name: 'three',
      ref: sha,
      from: 'src/held.ts',
      line: 12,
      column: 6,
    });
  });

  it('keeps the commit of a card inside a section that names other commits', async () => {
    const { container } = renderCard(fixupOf([changed({ path: 'src/example.ts' })]), {}, (ui) => (
      <div data-symbol-old-ref="sec1111^" data-symbol-new-ref="sec1111">
        {ui}
      </div>
    ));

    const card = screen.getByTestId('fixup-overlay-card');
    expect(await clicked(card, 'three')).toMatchObject({ ref: sha, line: 12, column: 6 });
    const diffLine = container.querySelector('[data-symbol-side="new"]')!;
    expect(await clicked(diffLine, 'first')).toEqual({
      name: 'first',
      ref: 'sec1111',
      from: 'src/example.ts',
      line: 10,
      column: 6,
    });
  });

  it('looks a name up in the fixup commit from a box in another file', async () => {
    const file = changed({ path: 'src/caller.ts' });
    renderWithProviders(
      <FixupOverlayProvider
        value={{
          ...EMPTY_FIXUP_OVERLAY,
          targetCommit: 'b7c2e10',
          enabled: true,
          boxesByFile: new Map([
            [
              'src/caller.ts',
              boxesByAnchor([
                {
                  fixup: fixupOf([file]),
                  threads: [{ id: 't1', file: 'src/example.ts', line: 12 }],
                  file,
                  chunk: file.chunks[0]!,
                  chunkIndex: 0,
                  anchor: 12,
                },
              ]),
            ],
          ]),
        }}
      >
        <DiffChunk
          chunk={testChunk}
          chunkIndex={0}
          threads={[]}
          mode={mode}
          onAddComment={asyncNoop}
          onResolveThread={noop}
          onReplyToThread={asyncNoop}
          onRemoveMessage={noop}
          onUpdateMessage={noop}
          filename="src/caller.ts"
        />
      </FixupOverlayProvider>,
    );

    const box = screen.getByTestId('fixup-file-box');
    expect(await clicked(box, 'third')).toEqual({
      name: 'third',
      ref: `${sha}^`,
      from: 'src/caller.ts',
      line: 12,
      column: 6,
    });
  });
});
