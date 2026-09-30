import { MessageSquare } from 'lucide-react';
import { memo, useMemo } from 'react';

import { type CommentThread, type DiffFile } from '../../types/diff';

interface FileChipsProps {
  files: DiffFile[];
  comments: CommentThread[];
  reviewedFiles: Set<string>;
  selectedFileIndex: number | null;
  onScrollToFile: (path: string) => void;
}

const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

export const FileChips = memo(function FileChips({
  files,
  comments,
  reviewedFiles,
  selectedFileIndex,
  onScrollToFile,
}: FileChipsProps) {
  const commentCounts = useMemo(() => {
    const counts = new Map<string, number>();
    comments.forEach((comment) => {
      counts.set(comment.file, (counts.get(comment.file) ?? 0) + 1);
    });
    return counts;
  }, [comments]);

  return (
    <nav
      aria-label="Changed files"
      data-testid="file-chips"
      className="flex gap-2 overflow-x-auto px-3 py-2 bg-github-bg-secondary border-b border-github-border"
    >
      {files.map((file, index) => {
        const commentCount = commentCounts.get(file.path) ?? 0;
        const isViewed = reviewedFiles.has(file.path);
        const isCurrent = selectedFileIndex === index;
        return (
          <button
            key={file.path}
            type="button"
            title={file.path}
            data-viewed={isViewed ? 'true' : undefined}
            aria-current={isCurrent ? 'true' : undefined}
            onClick={() => onScrollToFile(file.path)}
            className={`shrink-0 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-mono whitespace-nowrap transition-colors ${
              isCurrent
                ? 'border-github-text-secondary bg-github-bg-tertiary'
                : 'border-github-border bg-github-bg-primary'
            } ${isViewed ? 'text-github-text-muted line-through' : 'text-github-text-primary'}`}
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
