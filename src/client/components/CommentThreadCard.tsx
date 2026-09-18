import { Check, ChevronDown, ChevronRight, Copy, Edit2, MessageSquare, Trash2 } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';

import {
  type AnchorStaleReason,
  type CommentThread,
  type DiffCommentMessage,
} from '../../types/diff';
import { isSameCommit } from '../../utils/diffSelection';
import { reviewStateLabel } from '../../utils/reviewDecisions';
import type { ThreadReviewControls } from '../contexts/FixupOverlayContext';
import { useClickOutside } from '../hooks/useClickOutside';
import { copyTextToClipboard } from '../utils/clipboard';

import { CommentBodyRenderer } from './CommentBodyRenderer';
import { CommentForm } from './CommentForm';
import type { AppearanceSettings } from './SettingsModal';

interface ThreadMessageItemProps {
  message: DiffCommentMessage;
  isRootMessage?: boolean;
  showAuthorBadge: boolean;
  syntaxTheme?: AppearanceSettings['syntaxTheme'];
  filename?: string;
  originalCode?: string;
  onUpdate: (newBody: string) => void;
  onResolveOrDelete: () => void;
  actionLabel: string;
  confirmPrompt?: string;
  onClick?: (e: React.MouseEvent) => void;
}

function ThreadMessageItem({
  message,
  isRootMessage = false,
  showAuthorBadge,
  syntaxTheme,
  filename,
  originalCode,
  onUpdate,
  onResolveOrDelete,
  actionLabel,
  confirmPrompt,
  onClick,
}: ThreadMessageItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const confirmContainerRef = useRef<HTMLDivElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const showAuthorHeader = showAuthorBadge && Boolean(message.author);
  const isUserAuthoredMessage = message.author?.trim() === 'User';

  useClickOutside(confirmContainerRef, () => setIsConfirming(false), isConfirming);

  useEffect(() => {
    if (!isConfirming) return;

    confirmButtonRef.current?.focus();

    // Capture phase so Escape only cancels the confirmation and never reaches
    // surrounding Escape handlers (e.g. the CommentsListModal close hotkey).
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setIsConfirming(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [isConfirming]);

  const handleStartEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
  };

  const handleSaveEdit = (nextBody: string) => {
    if (nextBody !== message.body) {
      onUpdate(nextBody);
    }
    setIsEditing(false);
    return Promise.resolve();
  };

  return (
    <div className={isEditing ? '' : 'flex min-w-0 items-start gap-3'} onClick={onClick}>
      {!isEditing ? (
        <>
          <div className="min-w-0 flex-1">
            {showAuthorHeader && (
              <div className="mb-2 flex min-w-0 items-center gap-2 pr-2 text-xs text-github-text-secondary">
                <span className="inline-flex items-center rounded-full border border-github-border bg-github-bg-primary px-2 py-0.5 text-[11px] font-medium text-github-text-primary">
                  {message.author}
                </span>
              </div>
            )}

            <CommentBodyRenderer
              body={message.body}
              originalCode={originalCode}
              filename={filename}
              syntaxTheme={syntaxTheme}
            />
          </div>
          {(isRootMessage || isUserAuthoredMessage) &&
            (isConfirming ? (
              <div
                ref={confirmContainerRef}
                className="flex shrink-0 items-center gap-1.5 pt-0.5"
                onClick={(e) => e.stopPropagation()}
              >
                <span className="whitespace-nowrap text-xs text-github-text-secondary">
                  {confirmPrompt}
                </span>
                <button
                  ref={confirmButtonRef}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsConfirming(false);
                    onResolveOrDelete();
                  }}
                  className={`whitespace-nowrap rounded border border-github-border bg-github-bg-tertiary px-2 py-1 text-xs font-medium transition-all hover:bg-github-bg-primary ${
                    isRootMessage ? 'text-green-700 hover:text-green-800' : 'text-github-danger'
                  }`}
                >
                  {isRootMessage ? 'Resolve' : 'Delete'}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsConfirming(false);
                  }}
                  className="whitespace-nowrap rounded border border-github-border bg-github-bg-tertiary px-2 py-1 text-xs text-github-text-primary transition-all hover:bg-github-bg-primary"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex shrink-0 items-start gap-2 pt-0.5">
                {isUserAuthoredMessage && (
                  <button
                    type="button"
                    onClick={handleStartEdit}
                    className="rounded border border-github-border bg-github-bg-tertiary p-1.5 text-github-text-primary transition-all hover:bg-github-bg-primary"
                    title="Edit message"
                  >
                    <Edit2 size={12} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirmPrompt) {
                      setIsConfirming(true);
                      return;
                    }
                    onResolveOrDelete();
                  }}
                  className={`rounded border border-github-border bg-github-bg-tertiary p-1.5 transition-all hover:bg-github-bg-primary ${
                    isRootMessage ? 'text-green-700 hover:text-green-800' : 'text-github-danger'
                  }`}
                  title={actionLabel}
                  aria-label={actionLabel}
                >
                  {isRootMessage ? <Check size={12} /> : <Trash2 size={12} />}
                </button>
              </div>
            ))}
        </>
      ) : (
        <CommentForm
          onSubmit={handleSaveEdit}
          onCancel={handleCancelEdit}
          selectedCode={originalCode}
          syntaxTheme={syntaxTheme}
          filename={filename}
          initialValue={message.body}
          embedded={true}
          title="Edit comment"
          submitLabel="Save"
          placeholder="Edit your message..."
        />
      )}
    </div>
  );
}

const OUTDATED_REASON_TITLE: Record<AnchorStaleReason, string> = {
  missing: '지적한 줄이 지금 파일에 없어 수정을 겹쳐 그리지 않습니다',
  ambiguous: '같은 내용의 줄이 여러 곳이라 자리를 정할 수 없어 수정을 겹쳐 그리지 않습니다',
};

interface CommentThreadCardProps {
  thread: CommentThread;
  review?: ThreadReviewControls;
  showAuthorBadges?: boolean;
  confirmRootAction?: boolean;
  onGeneratePrompt: (thread: CommentThread) => string;
  onRemoveThread: (threadId: string) => void;
  onReplyToThread: (threadId: string, body: string) => Promise<void>;
  onRemoveMessage: (threadId: string, messageId: string) => void;
  onUpdateMessage: (threadId: string, messageId: string, newBody: string) => void;
  onClick?: (e: React.MouseEvent) => void;
  syntaxTheme?: AppearanceSettings['syntaxTheme'];
}

export function CommentThreadCard({
  thread,
  review,
  showAuthorBadges = false,
  confirmRootAction = true,
  onGeneratePrompt,
  onRemoveThread,
  onReplyToThread,
  onRemoveMessage,
  onUpdateMessage,
  onClick,
  syntaxTheme,
}: CommentThreadCardProps) {
  const [isCopied, setIsCopied] = useState(false);
  const [isReplying, setIsReplying] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const lineLabel = Array.isArray(thread.line)
    ? `${thread.line[0]}-${thread.line[1]}`
    : thread.line;

  const toggleCollapsed = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsCollapsed((prev) => !prev);
  };

  const handleCopyThread = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const prompt = onGeneratePrompt(thread);
      await copyTextToClipboard(prompt);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy thread prompt:', error);
    }
  };

  const anchorCommit =
    review &&
    thread.isOutdated &&
    thread.anchorCommit &&
    !(review.targetCommit && isSameCommit(thread.anchorCommit, review.targetCommit))
      ? thread.anchorCommit
      : null;

  const rootMessage = thread.messages[0];
  if (!rootMessage) return null;

  return (
    <div
      id={`comment-thread-${thread.id}`}
      className={`rounded-md border border-l-4 bg-github-bg-tertiary p-3 shadow-sm transition-all ${
        review
          ? thread.isOutdated
            ? 'border-github-border border-l-github-danger'
            : 'border-github-border border-l-github-text-muted'
          : 'border-yellow-600/50 border-l-yellow-400'
      } ${onClick ? 'cursor-pointer hover:shadow-md' : ''}`}
      onClick={onClick}
    >
      <div className={`flex items-center justify-between gap-3 ${isCollapsed ? '' : 'mb-3'}`}>
        <div className="flex min-w-0 flex-1 items-center gap-2 text-xs text-github-text-secondary">
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-expanded={!isCollapsed}
            aria-label={isCollapsed ? 'Expand thread' : 'Collapse thread'}
            title={isCollapsed ? 'Expand thread' : 'Collapse thread'}
            className="shrink-0 rounded p-0.5 text-github-text-secondary transition-colors hover:bg-github-bg-primary hover:text-github-text-primary"
          >
            {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </button>
          <span
            className="font-mono px-1 py-0.5 rounded overflow-hidden text-ellipsis whitespace-nowrap"
            style={{
              backgroundColor: 'var(--color-yellow-path-bg)',
              color: 'var(--color-yellow-path-text)',
            }}
          >
            {thread.file}:{lineLabel}
          </span>
          {review && (
            <span
              data-testid="review-state-chip"
              className="inline-flex h-5 shrink-0 items-center rounded-full border border-github-border px-2 text-[10px] font-medium text-github-text-secondary"
            >
              {reviewStateLabel(review.state)}
            </span>
          )}
          {thread.isOutdated && (
            <span
              className={`inline-flex h-5 shrink-0 items-center rounded-full border px-2 text-[10px] font-medium ${
                review
                  ? 'border-github-danger text-github-danger'
                  : 'border-github-text-muted text-github-text-muted'
              }`}
              title={
                review && thread.outdatedReason
                  ? OUTDATED_REASON_TITLE[thread.outdatedReason]
                  : 'Code has changed since this comment was made'
              }
              aria-label="Outdated comment"
            >
              {review ? '낡음' : 'Outdated'}
            </span>
          )}
          {isCollapsed && (
            <button
              type="button"
              onClick={toggleCollapsed}
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
              title="Expand thread"
            >
              <span className="min-w-0 flex-1 truncate text-github-text-secondary">
                {rootMessage.body.split('\n')[0]}
              </span>
              <span
                className="inline-flex shrink-0 items-center gap-1 text-github-text-muted"
                aria-label={`${thread.messages.length} messages in thread`}
              >
                <MessageSquare size={12} />
                {thread.messages.length}
              </span>
            </button>
          )}
        </div>
        {!isCollapsed && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopyThread}
              className="whitespace-nowrap rounded px-2 py-1 text-xs transition-all"
              style={{
                backgroundColor: 'var(--color-yellow-btn-bg)',
                color: 'var(--color-yellow-btn-text)',
                border: '1px solid var(--color-yellow-btn-border)',
              }}
              title="Copy thread prompt for AI coding agent"
            >
              <span className="inline-flex items-center gap-1">
                <Copy size={12} />
                {isCopied ? 'Copied!' : 'Copy Prompt'}
              </span>
            </button>
          </div>
        )}
      </div>

      {!isCollapsed && (
        <div className="space-y-3">
          <ThreadMessageItem
            message={rootMessage}
            isRootMessage={true}
            showAuthorBadge={showAuthorBadges}
            syntaxTheme={syntaxTheme}
            filename={thread.file}
            originalCode={thread.codeContent}
            onUpdate={(newBody) => onUpdateMessage(thread.id, rootMessage.id, newBody)}
            onResolveOrDelete={() => onRemoveThread(thread.id)}
            actionLabel="Resolve thread"
            confirmPrompt={confirmRootAction ? 'Resolve?' : undefined}
          />

          {thread.messages.slice(1).map((message) => (
            <div key={message.id} className="ml-4 border-l border-github-border pl-3">
              <ThreadMessageItem
                message={message}
                showAuthorBadge={showAuthorBadges}
                syntaxTheme={syntaxTheme}
                filename={thread.file}
                originalCode={thread.codeContent}
                onUpdate={(newBody) => onUpdateMessage(thread.id, message.id, newBody)}
                onResolveOrDelete={() => onRemoveMessage(thread.id, message.id)}
                actionLabel="Delete reply"
                confirmPrompt="Delete?"
              />
            </div>
          ))}

          {review && (review.state === 'awaiting-approval' || review.state === 'approved') && (
            <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
              {review.state === 'awaiting-approval' && review.fixupSha && (
                <>
                  <button
                    type="button"
                    onClick={() => review.onDecide(thread.id, 'approved', review.fixupSha ?? '')}
                    className="min-h-10 flex-1 rounded border border-github-accent bg-github-accent/20 px-3 text-sm font-medium text-github-text-primary"
                  >
                    승인
                  </button>
                  <button
                    type="button"
                    onClick={() => review.onDecide(thread.id, 'rejected', review.fixupSha ?? '')}
                    className="min-h-10 flex-1 rounded border border-github-danger bg-github-danger/20 px-3 text-sm font-medium text-github-text-primary"
                  >
                    거절
                  </button>
                </>
              )}
              {review.state === 'approved' && (
                <button
                  type="button"
                  onClick={() => review.onUndoApproval(thread.id)}
                  className="min-h-10 flex-1 rounded border border-github-border bg-github-bg-secondary px-3 text-sm text-github-text-secondary"
                >
                  승인 취소
                </button>
              )}
            </div>
          )}

          {review && anchorCommit && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                review.onOpenReviewAt(anchorCommit);
              }}
              className="min-h-10 w-full rounded border border-github-border bg-github-bg-secondary px-3 text-sm text-github-text-primary"
              title={`${anchorCommit} 커밋을 대상으로 리뷰를 다시 엽니다`}
            >
              이 지적을 달던 시점으로
            </button>
          )}

          <div
            className="ml-4 border-l border-github-border pl-3"
            onClick={(e) => e.stopPropagation()}
          >
            {isReplying ? (
              <CommentForm
                onSubmit={async (body) => {
                  await onReplyToThread(thread.id, body);
                  setIsReplying(false);
                }}
                onCancel={() => setIsReplying(false)}
                selectedCode={thread.codeContent}
                syntaxTheme={syntaxTheme}
                filename={thread.file}
                embedded={true}
                title="Reply to thread"
                submitLabel="Reply"
                placeholder="Write a reply..."
              />
            ) : (
              <button
                type="button"
                data-reply-trigger="true"
                onFocus={() => setIsReplying(true)}
                onClick={() => setIsReplying(true)}
                className="w-full cursor-text rounded border border-github-border bg-github-bg-secondary px-3 py-1.5 text-left text-sm text-github-text-muted transition-colors hover:border-github-text-secondary"
              >
                Write a reply...
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
