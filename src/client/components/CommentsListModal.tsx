import { X } from 'lucide-react';
import { useEffect, useState, useRef, useCallback } from 'react';
import { useHotkeys, useHotkeysContext } from 'react-hotkeys-hook';

import type { CommentThread } from '../../types/diff';
import { isThreadResolved } from '../../utils/reviewDecisions';
import { FixupOverlayProvider, type FixupOverlayState } from '../contexts/FixupOverlayContext';

import { CommentThreadCard } from './CommentThreadCard';
import type { AppearanceSettings } from './SettingsModal';

interface CommentsListModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (thread: CommentThread) => void;
  comments: CommentThread[];
  fixupOverlay: FixupOverlayState;
  showAuthorBadges?: boolean;
  onResolveThread: (threadId: string) => void;
  onReplyToThread: (threadId: string, body: string) => Promise<void>;
  onRemoveMessage: (threadId: string, messageId: string) => void;
  onUpdateMessage: (threadId: string, messageId: string, newBody: string) => void;
  syntaxTheme?: AppearanceSettings['syntaxTheme'];
}

export function CommentsListModal({
  isOpen,
  onClose,
  onNavigate,
  comments,
  fixupOverlay,
  showAuthorBadges = false,
  onResolveThread,
  onReplyToThread,
  onRemoveMessage,
  onUpdateMessage,
  syntaxTheme,
}: CommentsListModalProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const commentRefs = useRef<(HTMLDivElement | null)[]>([]);
  const { enableScope, disableScope } = useHotkeysContext();

  const sortedThreads = [...comments].sort((a, b) => {
    const fileCompare = a.file.localeCompare(b.file);
    if (fileCompare !== 0) return fileCompare;

    const aLine = Array.isArray(a.line) ? a.line[0] : a.line;
    const bLine = Array.isArray(b.line) ? b.line[0] : b.line;
    if (aLine !== bLine) return aLine - bLine;

    return a.createdAt.localeCompare(b.createdAt);
  });

  const handleThreadClick = useCallback(
    (thread: CommentThread) => {
      onNavigate(thread);
      onClose();
    },
    [onClose, onNavigate],
  );

  useEffect(() => {
    if (isOpen) {
      enableScope('comments-list');
      disableScope('navigation');
    } else {
      enableScope('navigation');
      disableScope('comments-list');
      setSelectedIndex(0);
    }

    return () => {
      enableScope('navigation');
      disableScope('comments-list');
    };
  }, [disableScope, enableScope, isOpen]);

  const hotkeyOptions = { scopes: 'comments-list', enableOnFormTags: false };

  useHotkeys('escape', () => onClose(), hotkeyOptions, [onClose]);

  useHotkeys(
    'j, down',
    () => setSelectedIndex((prev) => Math.min(prev + 1, sortedThreads.length - 1)),
    hotkeyOptions,
    [sortedThreads.length],
  );

  useHotkeys('k, up', () => setSelectedIndex((prev) => Math.max(prev - 1, 0)), hotkeyOptions, []);

  useHotkeys(
    'enter',
    () => {
      if (sortedThreads[selectedIndex]) {
        handleThreadClick(sortedThreads[selectedIndex]);
      }
    },
    hotkeyOptions,
    [handleThreadClick, selectedIndex, sortedThreads],
  );

  useHotkeys(
    'd',
    () => {
      const thread = sortedThreads[selectedIndex];
      if (thread && !isThreadResolved(thread.id, fixupOverlay.decisions)) {
        onResolveThread(thread.id);
      }
    },
    hotkeyOptions,
    [fixupOverlay.decisions, onResolveThread, selectedIndex, sortedThreads],
  );

  useEffect(() => {
    if (commentRefs.current[selectedIndex]) {
      commentRefs.current[selectedIndex]?.scrollIntoView({
        block: 'nearest',
      });
    }
  }, [selectedIndex]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative max-h-[80vh] w-full max-w-4xl overflow-hidden rounded-lg border border-github-border bg-github-bg-primary shadow-lg">
        <div className="sticky top-0 border-b border-github-border bg-github-bg-primary px-6 py-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-github-text-primary">All Comments</h2>
            <button
              onClick={onClose}
              className="text-github-text-secondary transition-colors hover:text-github-text-primary"
              aria-label="Close comments list"
            >
              <X size={20} />
            </button>
          </div>
          <div className="text-xs text-github-text-secondary">
            <span className="font-mono">j/k</span> or <span className="font-mono">↑/↓</span> to
            navigate • <span className="font-mono">Enter</span> to jump •{' '}
            <span className="font-mono">d</span> to resolve • <span className="font-mono">Esc</span>{' '}
            to close
          </div>
        </div>

        <div className="max-h-[calc(80vh-120px)] overflow-y-auto">
          <div className="p-6">
            {sortedThreads.length === 0 ? (
              <p className="text-center text-github-text-secondary">No comments yet</p>
            ) : (
              <FixupOverlayProvider value={fixupOverlay}>
                <div className="space-y-2">
                  {sortedThreads.map((thread, index) => (
                    <div
                      key={thread.id}
                      ref={(el) => {
                        commentRefs.current[index] = el;
                      }}
                      className={selectedIndex === index ? 'rounded ring-2 ring-blue-500' : ''}
                    >
                      <CommentThreadCard
                        thread={thread}
                        showAuthorBadges={showAuthorBadges}
                        onResolveThread={onResolveThread}
                        onReplyToThread={onReplyToThread}
                        onRemoveMessage={onRemoveMessage}
                        onUpdateMessage={onUpdateMessage}
                        syntaxTheme={syntaxTheme}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedIndex(index);
                          handleThreadClick(thread);
                        }}
                      />
                    </div>
                  ))}
                </div>
                <div className="mt-4 border-t border-github-border pt-4 text-center text-xs text-github-text-secondary">
                  {selectedIndex + 1} of {sortedThreads.length} threads
                </div>
              </FixupOverlayProvider>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
