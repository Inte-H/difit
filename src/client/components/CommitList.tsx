import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';

import type { ReviewCommit } from '../../types/diff';

export type ShownPart = 'all' | ReviewCommit | { from: string; to: string };

interface CommitListProps {
  commits: readonly ReviewCommit[];
  shown: ShownPart;
  onShowAll: () => void;
  onShowCommit: (commit: ReviewCommit) => void;
}

const ITEM_CLASS =
  'w-full flex items-center gap-2 px-4 py-1.5 text-left text-sm hover:bg-github-bg-tertiary transition-colors';
const CURRENT_CLASS = 'bg-github-bg-tertiary text-github-text-primary font-medium';

export function CommitList({ commits, shown, onShowAll, onShowCommit }: CommitListProps) {
  const [isOpen, setIsOpen] = useState(true);
  const viewed = shown !== 'all' && 'sha' in shown ? shown : null;

  return (
    <section className="shrink-0 border-b border-github-border" aria-label="리뷰 범위의 커밋">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        className="w-full flex items-center gap-2 px-4 py-2 text-sm bg-github-bg-tertiary hover:bg-github-bg-primary transition-colors"
      >
        {isOpen ? (
          <ChevronDown size={16} className="shrink-0 text-github-text-secondary" />
        ) : (
          <ChevronRight size={16} className="shrink-0 text-github-text-secondary" />
        )}
        <span className="shrink-0 font-semibold text-github-text-primary">
          커밋 {commits.length}개
        </span>
        <span className="min-w-0 truncate text-github-text-secondary">
          {shown === 'all' ? (
            '전체'
          ) : 'sha' in shown ? (
            <>
              <code className="font-mono">{shown.shortSha}</code> {shown.subject}
            </>
          ) : (
            <code className="font-mono">
              {shown.from}..{shown.to}
            </code>
          )}
        </span>
      </button>
      {isOpen && (
        <ul className="max-h-60 overflow-y-auto py-1 m-0 list-none p-0">
          <li>
            <button
              type="button"
              onClick={onShowAll}
              aria-current={shown === 'all' ? true : undefined}
              className={`${ITEM_CLASS} ${shown === 'all' ? CURRENT_CLASS : 'text-github-text-secondary'}`}
            >
              전체
            </button>
          </li>
          {commits.map((commit) => {
            const isCurrent = viewed?.sha === commit.sha;
            return (
              <li key={commit.sha}>
                <button
                  type="button"
                  onClick={() => onShowCommit(commit)}
                  aria-current={isCurrent ? true : undefined}
                  title={commit.subject}
                  className={`${ITEM_CLASS} ${isCurrent ? CURRENT_CLASS : 'text-github-text-secondary'}`}
                >
                  <code className="shrink-0 font-mono text-xs">{commit.shortSha}</code>
                  <span className="min-w-0 truncate">{commit.subject}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
