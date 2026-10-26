import { MessageSquare } from 'lucide-react';
import { memo, useEffect, useMemo, useRef } from 'react';

import { type CommentThread, type DiffFile } from '../../types/diff';

interface FileChipsProps {
  files: DiffFile[];
  comments: CommentThread[];
  resolvedThreadIds: ReadonlySet<string>;
  reviewedFiles: Set<string>;
  selectedFileIndex: number | null;
  scrollVisibleFileIndex?: number | null;
  pickedCommentFilePath?: string | null;
  onScrollToFile: (path: string) => void;
}

const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

export const FileChips = memo(function FileChips({
  files,
  comments,
  resolvedThreadIds,
  reviewedFiles,
  selectedFileIndex,
  scrollVisibleFileIndex = null,
  pickedCommentFilePath = null,
  onScrollToFile,
}: FileChipsProps) {
  const stripRef = useRef<HTMLElement>(null);
  const chipRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const commentCounts = useMemo(() => {
    const counts = new Map<string, number>();
    comments.forEach((comment) => {
      if (resolvedThreadIds.has(comment.id)) return;
      counts.set(comment.file, (counts.get(comment.file) ?? 0) + 1);
    });
    return counts;
  }, [comments, resolvedThreadIds]);

  const scrollVisiblePath =
    scrollVisibleFileIndex === null ? undefined : files[scrollVisibleFileIndex]?.path;
  useEffect(() => {
    const strip = stripRef.current;
    const chip =
      scrollVisiblePath === undefined ? undefined : chipRefs.current.get(scrollVisiblePath);
    if (!strip || !chip) return;

    const stripLeft = strip.getBoundingClientRect().left;
    const chipRect = chip.getBoundingClientRect();
    const chipLeft = chipRect.left - stripLeft;
    const chipRight = chipRect.right - stripLeft;
    if (chipLeft < 0) {
      strip.scrollLeft += chipLeft;
    } else if (chipRight > strip.clientWidth) {
      strip.scrollLeft += chipRight - strip.clientWidth;
    }
  }, [scrollVisiblePath]);

  return (
    <nav
      ref={stripRef}
      aria-label="Changed files"
      data-testid="file-chips"
      className="flex gap-2 overflow-x-auto px-3 py-2 bg-github-bg-secondary border-b border-github-border"
    >
      {files.map((file, index) => {
        const commentCount = commentCounts.get(file.path) ?? 0;
        const isViewed = reviewedFiles.has(file.path);
        const isCurrent = selectedFileIndex === index;
        const isScrollVisible = scrollVisibleFileIndex === index;
        const isPickedCommentFile = pickedCommentFilePath === file.path;
        return (
          <button
            key={file.path}
            ref={(el) => {
              if (el) {
                chipRefs.current.set(file.path, el);
              } else {
                chipRefs.current.delete(file.path);
              }
            }}
            type="button"
            title={file.path}
            data-viewed={isViewed ? 'true' : undefined}
            aria-current={isCurrent ? 'true' : undefined}
            data-scroll-visible={isScrollVisible ? 'true' : undefined}
            data-picked-comment={isPickedCommentFile ? 'true' : undefined}
            onClick={() => onScrollToFile(file.path)}
            className={`shrink-0 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-mono whitespace-nowrap transition-colors ${
              isCurrent
                ? 'border-github-text-secondary bg-github-bg-tertiary'
                : 'border-github-border bg-github-bg-primary'
            } ${isViewed ? 'text-github-text-muted line-through' : 'text-github-text-primary'} ${
              isScrollVisible ? 'shadow-[inset_3px_0_0_0_var(--color-github-text-secondary)]' : ''
            } ${isPickedCommentFile ? 'ring-1 ring-blue-500' : ''}`}
          >
            {baseName(file.path)}
            {commentCount > 0 && (
              <span
                className="inline-flex items-center gap-0.5 text-github-text-secondary"
                aria-label={`${commentCount} comments`}
              >
                <MessageSquare size={12} aria-hidden="true" />
                {commentCount}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
});
