import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CommentThread, ReviewDecision } from '../../types/diff';
import {
  EMPTY_FIXUP_OVERLAY,
  FixupOverlayProvider,
  type FixupOverlayState,
} from '../contexts/FixupOverlayContext';
import { WordHighlightProvider } from '../contexts/WordHighlightContext';
import { copyTextToClipboard } from '../utils/clipboard';

import { CommentThreadCard } from './CommentThreadCard';

vi.mock('../utils/clipboard', () => ({
  copyTextToClipboard: vi.fn().mockResolvedValue(undefined),
}));

const mockThread: CommentThread = {
  id: 'thread-1',
  file: 'src/client/components/CommentThreadCard.tsx',
  line: 80,
  side: 'new',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  codeContent: 'const value = 1;',
  messages: [
    {
      id: 'message-1',
      body: 'Root comment',
      author: 'User',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    },
    {
      id: 'message-2',
      body: 'Reply comment',
      author: 'Reviewer',
      createdAt: '2024-01-01T00:01:00Z',
      updatedAt: '2024-01-01T00:01:00Z',
    },
  ],
};

const threadWithUserReply: CommentThread = {
  ...mockThread,
  messages: [mockThread.messages[0]!, { ...mockThread.messages[1]!, author: 'User' }],
};

describe('CommentThreadCard', () => {
  beforeEach(() => {
    vi.mocked(copyTextToClipboard).mockClear();
  });

  it('copies one message with its location, not the whole thread', async () => {
    const user = userEvent.setup();
    render(
      <CommentThreadCard
        thread={mockThread}
        onResolveThread={vi.fn()}
        onReplyToThread={vi.fn().mockResolvedValue(undefined)}
        onRemoveMessage={vi.fn()}
        onUpdateMessage={vi.fn()}
      />,
    );

    const copyButtons = screen.getAllByRole('button', { name: 'Copy prompt' });
    expect(copyButtons).toHaveLength(2);
    await user.click(copyButtons[1]!);

    const copied = vi.mocked(copyTextToClipboard).mock.calls[0]?.[0];
    expect(copied).toContain('src/client/components/CommentThreadCard.tsx:L80');
    expect(copied).toContain('Reply comment');
    expect(copied).not.toContain('Root comment');
  });

  it('offers no suggestion button in the reply or edit form', async () => {
    const user = userEvent.setup();
    render(
      <CommentThreadCard
        thread={threadWithUserReply}
        onResolveThread={vi.fn()}
        onReplyToThread={vi.fn().mockResolvedValue(undefined)}
        onRemoveMessage={vi.fn()}
        onUpdateMessage={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Write a reply...' }));
    expect(screen.getByPlaceholderText('Write a reply...')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /suggestion/i })).toBeNull();

    await user.click(screen.getAllByTitle('Edit message')[0]!);
    expect(screen.getByPlaceholderText('Edit your message...')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /suggestion/i })).toBeNull();
  });

  it('draws a suggestion block as removed and added lines and copies it as ORIGINAL/SUGGESTED', async () => {
    const user = userEvent.setup();
    const suggestionThread: CommentThread = {
      ...mockThread,
      messages: [
        { ...mockThread.messages[0]!, body: 'Use two:\n\n```suggestion\nconst value = 2;\n```' },
      ],
    };
    const { container } = render(
      <WordHighlightProvider>
        <CommentThreadCard
          thread={suggestionThread}
          onResolveThread={vi.fn()}
          onReplyToThread={vi.fn().mockResolvedValue(undefined)}
          onRemoveMessage={vi.fn()}
          onUpdateMessage={vi.fn()}
        />
      </WordHighlightProvider>,
    );

    expect(container.querySelector('.bg-diff-deletion-bg')).toHaveTextContent('const value = 1;');
    expect(container.querySelector('.bg-diff-addition-bg')).toHaveTextContent('const value = 2;');

    await user.click(screen.getByRole('button', { name: 'Copy prompt' }));
    const copied = vi.mocked(copyTextToClipboard).mock.calls[0]?.[0];
    expect(copied).toContain('ORIGINAL:');
    expect(copied).toContain('const value = 1;');
    expect(copied).toContain('SUGGESTED:');
    expect(copied).toContain('const value = 2;');
  });

  it('does not show delete action for replies authored by someone else', () => {
    render(
      <CommentThreadCard
        thread={mockThread}
        onResolveThread={vi.fn()}
        onReplyToThread={vi.fn().mockResolvedValue(undefined)}
        onRemoveMessage={vi.fn()}
        onUpdateMessage={vi.fn()}
      />,
    );

    expect(screen.getByText('Reply comment')).toBeInTheDocument();
    expect(screen.queryByTitle('Delete reply')).not.toBeInTheDocument();
  });

  it('keeps resolve available for root comments even when not authored by the user', () => {
    render(
      <CommentThreadCard
        thread={{
          ...mockThread,
          messages: [
            {
              ...mockThread.messages[0]!,
              author: 'Reviewer',
            },
          ],
        }}
        onResolveThread={vi.fn()}
        onReplyToThread={vi.fn().mockResolvedValue(undefined)}
        onRemoveMessage={vi.fn()}
        onUpdateMessage={vi.fn()}
      />,
    );

    expect(screen.getByTitle('Resolve thread')).toBeInTheDocument();
    expect(screen.queryByTitle('Edit message')).not.toBeInTheDocument();
  });

  it('resolves a root comment without asking', async () => {
    const user = userEvent.setup();
    const onResolveThread = vi.fn();

    render(
      <CommentThreadCard
        thread={mockThread}
        onResolveThread={onResolveThread}
        onReplyToThread={vi.fn().mockResolvedValue(undefined)}
        onRemoveMessage={vi.fn()}
        onUpdateMessage={vi.fn()}
      />,
    );

    await user.click(screen.getByTitle('Resolve thread'));

    expect(screen.queryByText('Resolve?')).not.toBeInTheDocument();
    expect(onResolveThread).toHaveBeenCalledWith('thread-1');
  });

  it('cancels the inline delete confirmation with the cancel button', async () => {
    const user = userEvent.setup();
    const onRemoveMessage = vi.fn();

    render(
      <CommentThreadCard
        thread={threadWithUserReply}
        onResolveThread={vi.fn()}
        onReplyToThread={vi.fn().mockResolvedValue(undefined)}
        onRemoveMessage={onRemoveMessage}
        onUpdateMessage={vi.fn()}
      />,
    );

    await user.click(screen.getByTitle('Delete reply'));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onRemoveMessage).not.toHaveBeenCalled();
    expect(screen.queryByText('Delete?')).not.toBeInTheDocument();
    expect(screen.getByTitle('Delete reply')).toBeInTheDocument();
  });

  it('cancels the inline delete confirmation with Escape', async () => {
    const user = userEvent.setup();
    const onRemoveMessage = vi.fn();

    render(
      <CommentThreadCard
        thread={threadWithUserReply}
        onResolveThread={vi.fn()}
        onReplyToThread={vi.fn().mockResolvedValue(undefined)}
        onRemoveMessage={onRemoveMessage}
        onUpdateMessage={vi.fn()}
      />,
    );

    await user.click(screen.getByTitle('Delete reply'));
    await user.keyboard('{Escape}');

    expect(onRemoveMessage).not.toHaveBeenCalled();
    expect(screen.queryByText('Delete?')).not.toBeInTheDocument();
  });

  it('consumes Escape so surrounding Escape handlers do not fire', async () => {
    const user = userEvent.setup();
    const outerKeyDown = vi.fn();
    document.addEventListener('keydown', outerKeyDown);

    try {
      render(
        <CommentThreadCard
          thread={threadWithUserReply}
          onResolveThread={vi.fn()}
          onReplyToThread={vi.fn().mockResolvedValue(undefined)}
          onRemoveMessage={vi.fn()}
          onUpdateMessage={vi.fn()}
        />,
      );

      await user.click(screen.getByTitle('Delete reply'));
      await user.keyboard('{Escape}');

      expect(screen.queryByText('Delete?')).not.toBeInTheDocument();
      expect(outerKeyDown).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('keydown', outerKeyDown);
    }
  });

  it('cancels the inline delete confirmation when clicking outside', async () => {
    const user = userEvent.setup();
    const onRemoveMessage = vi.fn();

    render(
      <div>
        <button type="button">outside</button>
        <CommentThreadCard
          thread={threadWithUserReply}
          onResolveThread={vi.fn()}
          onReplyToThread={vi.fn().mockResolvedValue(undefined)}
          onRemoveMessage={onRemoveMessage}
          onUpdateMessage={vi.fn()}
        />
      </div>,
    );

    await user.click(screen.getByTitle('Delete reply'));
    await user.click(screen.getByRole('button', { name: 'outside' }));

    expect(onRemoveMessage).not.toHaveBeenCalled();
    expect(screen.queryByText('Delete?')).not.toBeInTheDocument();
  });

  describe('when resolved', () => {
    const resolution = (kind: 'resolved' | 'unresolved', at: string): ReviewDecision => ({
      threadId: 'thread-1',
      kind,
      fixupSha: '',
      at,
    });
    const overlayWith = (decisions: ReviewDecision[], recordDecision = vi.fn()) => ({
      ...EMPTY_FIXUP_OVERLAY,
      decisions,
      recordDecision,
    });
    const card = (overlay: FixupOverlayState) => (
      <FixupOverlayProvider value={overlay}>
        <CommentThreadCard
          thread={mockThread}
          onResolveThread={vi.fn()}
          onReplyToThread={vi.fn().mockResolvedValue(undefined)}
          onRemoveMessage={vi.fn()}
          onUpdateMessage={vi.fn()}
        />
      </FixupOverlayProvider>
    );

    it('starts collapsed with the check offering to reopen', () => {
      render(card(overlayWith([resolution('resolved', '2026-01-01T00:00:00Z')])));

      expect(screen.getByText('해결됨')).toBeInTheDocument();
      expect(screen.queryByText('Reply comment')).not.toBeInTheDocument();
      expect(screen.queryByTitle('Resolve thread')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Reopen thread' })).toBeInTheDocument();
    });

    it('collapses the moment the resolution lands', () => {
      const { rerender } = render(card(overlayWith([])));
      expect(screen.getByText('Reply comment')).toBeInTheDocument();

      rerender(card(overlayWith([resolution('resolved', '2026-01-01T00:00:00Z')])));

      expect(screen.queryByText('Reply comment')).not.toBeInTheDocument();
      expect(screen.getByText('해결됨')).toBeInTheDocument();
    });

    describe('while a reply is being written and the resolution arrives from elsewhere', () => {
      const replyingCard = (overlay: FixupOverlayState, onReplyToThread = vi.fn()) => (
        <FixupOverlayProvider value={overlay}>
          <CommentThreadCard
            thread={mockThread}
            onResolveThread={vi.fn()}
            onReplyToThread={onReplyToThread}
            onRemoveMessage={vi.fn()}
            onUpdateMessage={vi.fn()}
          />
        </FixupOverlayProvider>
      );

      it('keeps the reply form and its draft open under the resolved chip', async () => {
        const user = userEvent.setup();
        const { rerender } = render(replyingCard(overlayWith([])));
        await user.click(screen.getByRole('button', { name: 'Write a reply...' }));
        await user.type(screen.getByPlaceholderText('Write a reply...'), 'Half-written');

        rerender(replyingCard(overlayWith([resolution('resolved', '2026-01-01T00:00:00Z')])));

        expect(screen.getByText('해결됨')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Write a reply...')).toHaveValue('Half-written');
      });

      it('sends the draft and reopens the thread', async () => {
        const user = userEvent.setup();
        const onReplyToThread = vi.fn().mockResolvedValue(undefined);
        const recordDecision = vi.fn();
        const { rerender } = render(replyingCard(overlayWith([], recordDecision), onReplyToThread));
        await user.click(screen.getByRole('button', { name: 'Write a reply...' }));
        await user.type(screen.getByPlaceholderText('Write a reply...'), 'Half-written');

        rerender(
          replyingCard(
            overlayWith([resolution('resolved', '2026-01-01T00:00:00Z')], recordDecision),
            onReplyToThread,
          ),
        );
        await user.click(screen.getByRole('button', { name: '답글 달고 다시 열기' }));

        expect(onReplyToThread).toHaveBeenCalledWith('thread-1', 'Half-written');
        expect(recordDecision).toHaveBeenCalledWith('thread-1', 'unresolved', '');
      });

      it('collapses once the reply form is closed', async () => {
        const user = userEvent.setup();
        const { rerender } = render(replyingCard(overlayWith([])));
        await user.click(screen.getByRole('button', { name: 'Write a reply...' }));

        rerender(replyingCard(overlayWith([resolution('resolved', '2026-01-01T00:00:00Z')])));
        await user.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(screen.queryByText('Reply comment')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Expand thread' })).toBeInTheDocument();
      });
    });

    it('reopens the thread with an unresolved record when the check is pressed again', async () => {
      const user = userEvent.setup();
      const recordDecision = vi.fn();
      render(card(overlayWith([resolution('resolved', '2026-01-01T00:00:00Z')], recordDecision)));

      await user.click(screen.getByRole('button', { name: 'Reopen thread' }));

      expect(recordDecision).toHaveBeenCalledWith('thread-1', 'unresolved', '');
    });

    it('offers no verdict on a pending fixup once resolved', async () => {
      const user = userEvent.setup();
      render(
        <FixupOverlayProvider value={overlayWith([resolution('resolved', '2026-01-01T00:00:00Z')])}>
          <CommentThreadCard
            thread={mockThread}
            review={{
              state: 'awaiting-approval',
              fixupSha: 'abc1234',
              targetCommit: 'b7c2e10',
              onDecide: vi.fn(),
              onUndoApproval: vi.fn(),
              onOpenReviewAt: vi.fn(),
            }}
            onResolveThread={vi.fn()}
            onReplyToThread={vi.fn().mockResolvedValue(undefined)}
            onRemoveMessage={vi.fn()}
            onUpdateMessage={vi.fn()}
          />
        </FixupOverlayProvider>,
      );

      await user.click(screen.getByRole('button', { name: 'Expand thread' }));

      expect(screen.getByText('Reply comment')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '승인' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '거절' })).not.toBeInTheDocument();
    });

    it('reopens the thread after sending a reply to it', async () => {
      const user = userEvent.setup();
      const onReplyToThread = vi.fn().mockResolvedValue(undefined);
      const recordDecision = vi.fn();
      render(
        <FixupOverlayProvider
          value={overlayWith([resolution('resolved', '2026-01-01T00:00:00Z')], recordDecision)}
        >
          <CommentThreadCard
            thread={mockThread}
            onResolveThread={vi.fn()}
            onReplyToThread={onReplyToThread}
            onRemoveMessage={vi.fn()}
            onUpdateMessage={vi.fn()}
          />
        </FixupOverlayProvider>,
      );

      await user.click(screen.getByRole('button', { name: 'Expand thread' }));
      await user.click(screen.getByRole('button', { name: '답글 달고 다시 열기...' }));
      await user.type(screen.getByPlaceholderText('Write a reply...'), 'One more thing');
      await user.click(screen.getByRole('button', { name: '답글 달고 다시 열기' }));

      expect(onReplyToThread).toHaveBeenCalledWith('thread-1', 'One more thing');
      expect(recordDecision).toHaveBeenCalledWith('thread-1', 'unresolved', '');
      expect(onReplyToThread.mock.invocationCallOrder[0]).toBeLessThan(
        recordDecision.mock.invocationCallOrder[0]!,
      );
    });

    it('shows a reopened thread as open again', () => {
      render(
        card(
          overlayWith([
            resolution('resolved', '2026-01-01T00:00:00Z'),
            resolution('unresolved', '2026-01-01T00:01:00Z'),
          ]),
        ),
      );

      expect(screen.queryByText('해결됨')).not.toBeInTheDocument();
      expect(screen.getByText('Reply comment')).toBeInTheDocument();
      expect(screen.getByTitle('Resolve thread')).toBeInTheDocument();
    });
  });

  it('collapses the thread into a single line and expands it back', async () => {
    const user = userEvent.setup();

    render(
      <CommentThreadCard
        thread={mockThread}
        onResolveThread={vi.fn()}
        onReplyToThread={vi.fn().mockResolvedValue(undefined)}
        onRemoveMessage={vi.fn()}
        onUpdateMessage={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Collapse thread' }));

    expect(screen.queryByText('Reply comment')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy prompt' })).not.toBeInTheDocument();
    expect(screen.getByTitle('Resolve thread')).toBeInTheDocument();
    expect(screen.getByText('Root comment')).toBeInTheDocument();
    expect(screen.getByLabelText('2 messages in thread')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Expand thread' }));

    expect(screen.getByText('Reply comment')).toBeInTheDocument();
    expect(screen.getByTitle('Resolve thread')).toBeInTheDocument();
  });

  it('expands a collapsed thread by clicking the summary line', async () => {
    const user = userEvent.setup();

    render(
      <CommentThreadCard
        thread={mockThread}
        onResolveThread={vi.fn()}
        onReplyToThread={vi.fn().mockResolvedValue(undefined)}
        onRemoveMessage={vi.fn()}
        onUpdateMessage={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Collapse thread' }));
    await user.click(screen.getByText('Root comment'));

    expect(screen.getByText('Reply comment')).toBeInTheDocument();
  });

  it('does not trigger the card click when toggling collapse', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    render(
      <CommentThreadCard
        thread={mockThread}
        onResolveThread={vi.fn()}
        onReplyToThread={vi.fn().mockResolvedValue(undefined)}
        onRemoveMessage={vi.fn()}
        onUpdateMessage={vi.fn()}
        onClick={onClick}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Collapse thread' }));

    expect(onClick).not.toHaveBeenCalled();
  });

  it('shows the "Outdated" badge when the thread is marked outdated', () => {
    render(
      <CommentThreadCard
        thread={{ ...mockThread, isOutdated: true }}
        onResolveThread={vi.fn()}
        onReplyToThread={vi.fn().mockResolvedValue(undefined)}
        onRemoveMessage={vi.fn()}
        onUpdateMessage={vi.fn()}
      />,
    );

    const badge = screen.getByLabelText('Outdated comment');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('Outdated');
    expect(badge).toHaveAttribute('title', 'Code has changed since this comment was made');
  });

  it('does not render the "Outdated" badge when the thread is up to date', () => {
    render(
      <CommentThreadCard
        thread={mockThread}
        onResolveThread={vi.fn()}
        onReplyToThread={vi.fn().mockResolvedValue(undefined)}
        onRemoveMessage={vi.fn()}
        onUpdateMessage={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText('Outdated comment')).not.toBeInTheDocument();
  });

  const awaitingReview = {
    state: 'awaiting-approval' as const,
    fixupSha: 'abc1234',
    targetCommit: 'b7c2e10',
    onDecide: vi.fn(),
    onUndoApproval: vi.fn(),
    onOpenReviewAt: vi.fn(),
  };

  it('marks a stale review thread visibly while keeping its state chip and decision buttons', () => {
    render(
      <CommentThreadCard
        thread={{ ...mockThread, isOutdated: true, outdatedReason: 'ambiguous' }}
        review={awaitingReview}
        onResolveThread={vi.fn()}
        onReplyToThread={vi.fn().mockResolvedValue(undefined)}
        onRemoveMessage={vi.fn()}
        onUpdateMessage={vi.fn()}
      />,
    );

    const badge = screen.getByLabelText('Outdated comment');
    expect(badge).toHaveTextContent('낡음');
    expect(badge.getAttribute('title')).toContain('여러 곳');
    expect(screen.getByTestId('review-state-chip')).toHaveTextContent('승인 대기');
    expect(screen.getByRole('button', { name: '승인' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '거절' })).toBeInTheDocument();
  });

  it('offers to reopen the review at the anchor commit only on a stale thread made elsewhere', async () => {
    const user = userEvent.setup();
    const onOpenReviewAt = vi.fn();
    const staleThread = { ...mockThread, isOutdated: true, outdatedReason: 'missing' as const };
    const renderCard = (thread: CommentThread) => (
      <CommentThreadCard
        thread={thread}
        review={{ ...awaitingReview, onOpenReviewAt }}
        onResolveThread={vi.fn()}
        onReplyToThread={vi.fn().mockResolvedValue(undefined)}
        onRemoveMessage={vi.fn()}
        onUpdateMessage={vi.fn()}
      />
    );
    const reopenButton = () => screen.queryByRole('button', { name: '이 지적을 달던 시점으로' });

    const { rerender } = render(renderCard({ ...staleThread, anchorCommit: '6e4f6d5' }));
    await user.click(screen.getByRole('button', { name: '이 지적을 달던 시점으로' }));
    expect(onOpenReviewAt).toHaveBeenCalledWith('6e4f6d5');

    rerender(renderCard({ ...mockThread, anchorCommit: '6e4f6d5' }));
    expect(reopenButton()).not.toBeInTheDocument();

    rerender(renderCard({ ...staleThread, anchorCommit: 'b7c2e10' }));
    expect(reopenButton()).not.toBeInTheDocument();

    rerender(renderCard({ ...staleThread, anchorCommit: 'b7c2e10' + '0'.repeat(33) }));
    expect(reopenButton()).not.toBeInTheDocument();

    rerender(renderCard(staleThread));
    expect(reopenButton()).not.toBeInTheDocument();
  });

  it('always shows an inline reply trigger below the last message', () => {
    render(
      <CommentThreadCard
        thread={mockThread}
        onResolveThread={vi.fn()}
        onReplyToThread={vi.fn().mockResolvedValue(undefined)}
        onRemoveMessage={vi.fn()}
        onUpdateMessage={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Write a reply...' })).toBeInTheDocument();
  });

  it('expands the reply trigger into a reply form and submits a reply', async () => {
    const user = userEvent.setup();
    const onReplyToThread = vi.fn().mockResolvedValue(undefined);

    render(
      <CommentThreadCard
        thread={mockThread}
        onResolveThread={vi.fn()}
        onReplyToThread={onReplyToThread}
        onRemoveMessage={vi.fn()}
        onUpdateMessage={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Write a reply...' }));

    const textarea = screen.getByPlaceholderText('Write a reply...');
    expect(textarea).toHaveFocus();

    await user.type(textarea, 'A new reply');
    await user.click(screen.getByRole('button', { name: 'Reply' }));

    expect(onReplyToThread).toHaveBeenCalledWith('thread-1', 'A new reply');
    // Collapses back to the trigger after submitting
    expect(screen.getByRole('button', { name: 'Write a reply...' })).toBeInTheDocument();
  });

  it('collapses the reply form back to the trigger on cancel', async () => {
    const user = userEvent.setup();

    render(
      <CommentThreadCard
        thread={mockThread}
        onResolveThread={vi.fn()}
        onReplyToThread={vi.fn().mockResolvedValue(undefined)}
        onRemoveMessage={vi.fn()}
        onUpdateMessage={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Write a reply...' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByPlaceholderText('Write a reply...')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Write a reply...' })).toBeInTheDocument();
  });

  it('shows an inline confirmation before deleting a user-authored reply', async () => {
    const user = userEvent.setup();
    const onRemoveMessage = vi.fn();

    render(
      <CommentThreadCard
        thread={{
          ...mockThread,
          messages: [
            mockThread.messages[0]!,
            {
              ...mockThread.messages[1]!,
              author: 'User',
            },
          ],
        }}
        onResolveThread={vi.fn()}
        onReplyToThread={vi.fn().mockResolvedValue(undefined)}
        onRemoveMessage={onRemoveMessage}
        onUpdateMessage={vi.fn()}
      />,
    );

    await user.click(screen.getByTitle('Delete reply'));

    expect(onRemoveMessage).not.toHaveBeenCalled();
    expect(screen.getByText('Delete?')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(onRemoveMessage).toHaveBeenCalledWith('thread-1', 'message-2');
  });
});
