import { ChevronDown, ChevronRight } from 'lucide-react';
import { Fragment, useEffect, useState } from 'react';

import type { ReviewScope, ReviewView, ReviewViewAction } from '../../types/diff';
import { layoutCommitGraph } from '../../utils/commitGraph';
import { isSameCommit, selectReviewView } from '../../utils/diffSelection';

import { CommitGraph } from './CommitGraph';

interface CommitListProps {
  review: Pick<ReviewScope, 'requested' | 'commits'>;
  shown: ReviewView;
  onSelect: (action: ReviewViewAction) => void;
}

interface Drag {
  fromSha: string;
  overSha: string | null;
}

const ITEM_CLASS =
  'w-full flex items-center gap-2 px-4 py-1.5 text-left text-sm hover:bg-github-bg-tertiary transition-colors';
const CURRENT_CLASS = 'bg-github-bg-tertiary text-github-text-primary font-medium';
const CURRENT_COMMIT_CLASS = `${CURRENT_CLASS} shadow-[inset_2px_0_0_var(--color-github-accent)]`;
const PREVIEW_CLASS = 'outline-1 outline-dashed -outline-offset-1 outline-github-text-secondary';
const MERGED_CLASS = 'flex items-center gap-2 px-4 py-1.5 text-sm text-github-text-muted';
const CURRENT_MERGED_CLASS =
  'bg-github-bg-tertiary text-github-text-secondary shadow-[inset_2px_0_0_var(--color-github-accent)]';

export function CommitList({ review, shown, onSelect }: CommitListProps) {
  const { commits } = review;
  const [isOpen, setIsOpen] = useState(true);
  const [drag, setDrag] = useState<Drag | null>(null);
  const isDragging = drag !== null;

  useEffect(() => {
    if (!isDragging) return;
    const cancel = () => setDrag(null);
    window.addEventListener('mouseup', cancel);
    return () => window.removeEventListener('mouseup', cancel);
  }, [isDragging]);

  const indexOf = (sha: string) => commits.findIndex((commit) => isSameCommit(commit.sha, sha));
  const spanOf = (view: ReviewView): [number, number] =>
    view.kind === 'all'
      ? [0, commits.length - 1]
      : view.kind === 'commit'
        ? [indexOf(view.sha), indexOf(view.sha)]
        : [indexOf(view.startSha), indexOf(view.endSha)];
  const [shownStart, shownEnd] = shown.kind === 'all' ? [-1, -2] : spanOf(shown);
  const preview =
    drag?.overSha != null
      ? selectReviewView(
          review,
          { view: shown, anchor: null },
          { kind: 'drop', fromSha: drag.fromSha, toSha: drag.overSha },
        )
      : null;
  const [previewStart, previewEnd] = preview ? spanOf(preview.view) : [-1, -2];
  const first = shown.kind === 'range' ? commits[shownStart] : undefined;
  const last = shown.kind === 'range' ? commits[shownEnd] : undefined;
  const single = shown.kind === 'commit' ? commits[shownStart] : undefined;
  const graph = layoutCommitGraph(commits, shown.kind === 'all' ? null : [shownStart, shownEnd]);

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
          {single ? (
            <>
              <code className="font-mono">{single.shortSha}</code> {single.subject}
            </>
          ) : first && last ? (
            <>
              <code className="font-mono" title={`${first.subject} ~ ${last.subject}`}>
                {first.shortSha}~{last.shortSha}
              </code>{' '}
              ({shownEnd - shownStart + 1}개)
            </>
          ) : (
            '전체'
          )}
        </span>
      </button>
      {isOpen && (
        <ul className="max-h-60 overflow-y-auto py-1 m-0 list-none p-0 select-none">
          <li>
            <button
              type="button"
              onClick={() => onSelect({ kind: 'all' })}
              aria-current={shown.kind === 'all' ? true : undefined}
              className={`${ITEM_CLASS} ${shown.kind === 'all' ? CURRENT_CLASS : 'text-github-text-secondary'}`}
            >
              <span className="w-8 shrink-0" />
              전체
            </button>
          </li>
          {graph.map(({ commit, cell, merged }, index) => {
            const isCurrent = index >= shownStart && index <= shownEnd;
            const isPreviewed = index >= previewStart && index <= previewEnd;
            return (
              <Fragment key={commit.sha}>
                {merged.map((entry) => (
                  <li
                    key={entry.kind === 'commit' ? entry.commit.sha : `${commit.sha}:omitted`}
                    aria-current={isCurrent ? true : undefined}
                    title={entry.kind === 'commit' ? entry.commit.subject : undefined}
                    className={`${MERGED_CLASS} ${isCurrent ? CURRENT_MERGED_CLASS : ''}`}
                  >
                    <CommitGraph cell={entry.cell} />
                    {entry.kind === 'commit' ? (
                      <>
                        <code className="shrink-0 font-mono text-xs">{entry.commit.shortSha}</code>
                        <span className="min-w-0 truncate">{entry.commit.subject}</span>
                      </>
                    ) : (
                      <span>커밋 {entry.count}개 더</span>
                    )}
                  </li>
                ))}
                <li>
                  <button
                    type="button"
                    onMouseDown={(event) => {
                      if (event.button === 0 && !event.shiftKey) {
                        setDrag({ fromSha: commit.sha, overSha: null });
                      }
                    }}
                    onMouseEnter={() =>
                      setDrag((current) => current && { ...current, overSha: commit.sha })
                    }
                    onMouseUp={() => {
                      if (drag && drag.fromSha !== commit.sha) {
                        onSelect({ kind: 'drop', fromSha: drag.fromSha, toSha: commit.sha });
                      }
                      setDrag(null);
                    }}
                    onClick={(event) =>
                      onSelect({ kind: event.shiftKey ? 'shift-click' : 'click', sha: commit.sha })
                    }
                    aria-current={isCurrent ? true : undefined}
                    data-drag-preview={isPreviewed ? '' : undefined}
                    title={commit.subject}
                    className={`${ITEM_CLASS} ${isCurrent ? CURRENT_COMMIT_CLASS : 'text-github-text-secondary'} ${isPreviewed ? PREVIEW_CLASS : ''}`}
                  >
                    <CommitGraph cell={cell} />
                    <code className="shrink-0 font-mono text-xs">{commit.shortSha}</code>
                    <span className="min-w-0 truncate">{commit.subject}</span>
                  </button>
                </li>
              </Fragment>
            );
          })}
        </ul>
      )}
    </section>
  );
}
