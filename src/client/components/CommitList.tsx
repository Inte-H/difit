import { ChevronDown, ChevronRight } from 'lucide-react';
import { Fragment, useEffect, useRef, useState, type TouchEvent } from 'react';

import type { ReviewCommit, ReviewScope, ReviewView, ReviewViewAction } from '../../types/diff';
import { layoutCommitGraph } from '../../utils/commitGraph';
import { isSameCommit, selectReviewView } from '../../utils/diffSelection';

import { CommentCount } from './CommentCount';
import { CommitGraph } from './CommitGraph';

interface CommitListProps {
  review: Pick<ReviewScope, 'requested' | 'commits'>;
  shown: ReviewView;
  onSelect: (action: ReviewViewAction) => void;
  rangeStart?: string | undefined;
  inDrawer?: boolean;
  openCounts?: ReadonlyMap<string, number> | undefined;
}

interface Drag {
  fromSha: string;
  overSha: string | null;
}

interface Press {
  sha: string;
  x: number;
  y: number;
  timer: ReturnType<typeof setTimeout> | null;
}

const LONG_PRESS_MS = 500;
const TAP_SLOP_PX = 10;

const ITEM_CLASS =
  'w-full flex items-center gap-2 px-4 text-left text-sm hover:bg-github-bg-tertiary transition-colors';
const CURRENT_CLASS = 'bg-github-bg-tertiary text-github-text-primary font-medium';
const CURRENT_COMMIT_CLASS = `${CURRENT_CLASS} shadow-[inset_2px_0_0_var(--color-github-accent)]`;
const PREVIEW_CLASS = 'outline-1 outline-dashed -outline-offset-1 outline-github-text-secondary';
const MERGED_CLASS = 'flex items-center gap-2 px-4 text-sm text-github-text-muted';
const CURRENT_MERGED_CLASS =
  'bg-github-bg-tertiary text-github-text-secondary shadow-[inset_2px_0_0_var(--color-github-accent)]';

const commitUnder = (x: number, y: number) =>
  document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-commit-sha]')?.dataset.commitSha ??
  null;

export function ShownCommits({
  commits,
  shown,
}: {
  commits: readonly ReviewCommit[];
  shown: ReviewView;
}) {
  const find = (sha: string) => commits.find((commit) => isSameCommit(commit.sha, sha));
  if (shown.kind === 'commit') {
    const single = find(shown.sha);
    if (single) {
      return (
        <>
          <code className="font-mono">{single.shortSha}</code> {single.subject}
        </>
      );
    }
  }
  if (shown.kind === 'range') {
    const first = find(shown.startSha);
    const last = find(shown.endSha);
    if (first && last) {
      return (
        <>
          <code className="font-mono" title={`${first.subject} ~ ${last.subject}`}>
            {first.shortSha}~{last.shortSha}
          </code>{' '}
          ({commits.indexOf(last) - commits.indexOf(first) + 1}개)
        </>
      );
    }
  }
  return '전체';
}

export function CommitList({
  review,
  shown,
  onSelect,
  rangeStart,
  inDrawer = false,
  openCounts,
}: CommitListProps) {
  const { commits } = review;
  const [isOpen, setIsOpen] = useState(true);
  const [drag, setDrag] = useState<Drag | null>(null);
  const isDragging = drag !== null;
  const listRef = useRef<HTMLUListElement>(null);
  const pressRef = useRef<Press | null>(null);

  useEffect(() => {
    if (!isDragging) return;
    const cancel = () => setDrag(null);
    window.addEventListener('mouseup', cancel);
    return () => window.removeEventListener('mouseup', cancel);
  }, [isDragging]);

  const isListShown = inDrawer || isOpen;
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const onTouchMove = (event: globalThis.TouchEvent) => {
      const press = pressRef.current;
      const touch = event.touches[0];
      if (!press || !touch) return;
      if (press.timer !== null) {
        if (Math.hypot(touch.clientX - press.x, touch.clientY - press.y) > TAP_SLOP_PX) {
          clearTimeout(press.timer);
          pressRef.current = null;
        }
        return;
      }
      event.preventDefault();
      const overSha = commitUnder(touch.clientX, touch.clientY);
      setDrag((current) => current && { ...current, overSha });
    };
    list.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => list.removeEventListener('touchmove', onTouchMove);
  }, [isListShown]);

  useEffect(
    () => () => {
      const timer = pressRef.current?.timer;
      if (timer != null) clearTimeout(timer);
    },
    [],
  );

  const startPress = (sha: string, event: TouchEvent) => {
    const touch = event.touches[0];
    const previous = pressRef.current?.timer;
    if (previous != null) clearTimeout(previous);
    if (!touch || event.touches.length > 1) {
      pressRef.current = null;
      return;
    }
    const press: Press = { sha, x: touch.clientX, y: touch.clientY, timer: null };
    press.timer = setTimeout(() => {
      press.timer = null;
      setDrag({ fromSha: sha, overSha: null });
      onSelect({ kind: 'long-press', sha });
    }, LONG_PRESS_MS);
    pressRef.current = press;
  };
  const endPress = (event: TouchEvent) => {
    const press = pressRef.current;
    pressRef.current = null;
    if (!press) return;
    if (press.timer !== null) {
      clearTimeout(press.timer);
      return;
    }
    event.preventDefault();
    setDrag(null);
    const touch = event.changedTouches[0];
    const toSha = touch ? commitUnder(touch.clientX, touch.clientY) : null;
    if (toSha && toSha !== press.sha) onSelect({ kind: 'drop', fromSha: press.sha, toSha });
  };
  const cancelPress = () => {
    const timer = pressRef.current?.timer;
    if (timer != null) clearTimeout(timer);
    pressRef.current = null;
    setDrag(null);
  };

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
  const [previewStart, previewEnd] = preview
    ? spanOf(preview.view)
    : rangeStart !== undefined
      ? spanOf({ kind: 'commit', sha: rangeStart })
      : [-1, -2];
  const rowPadding = inDrawer ? 'py-3' : 'py-1.5';
  const graphBleed = inDrawer ? '-my-3' : '-my-1.5';
  const itemClass = `${ITEM_CLASS} ${rowPadding}`;
  const graph = layoutCommitGraph(commits);
  const openCountOf = (sha: string) => {
    const count = openCounts?.get(sha) ?? 0;
    return count > 0 && <CommentCount count={count} title={`열린 지적 ${count}개`} />;
  };
  const title = (
    <>
      <span className="shrink-0 font-semibold text-github-text-primary">
        커밋 {commits.length}개
      </span>
      <span className="min-w-0 truncate text-github-text-secondary">
        <ShownCommits commits={commits} shown={shown} />
      </span>
    </>
  );

  return (
    <section
      className={
        inDrawer ? 'flex-1 min-h-0 flex flex-col' : 'shrink-0 border-b border-github-border'
      }
      aria-label="리뷰 범위의 커밋"
    >
      {rangeStart !== undefined ? (
        <div className="shrink-0 flex items-center gap-2 px-4 py-2 text-sm bg-github-bg-tertiary">
          <span role="status" className="min-w-0 flex-1 truncate text-github-text-primary">
            범위 고르는 중
          </span>
          <button
            type="button"
            onClick={() => onSelect({ kind: 'cancel' })}
            className="shrink-0 px-2 py-0.5 text-sm text-github-text-secondary border border-github-border rounded hover:text-github-text-primary hover:bg-github-bg-primary transition-colors"
          >
            취소
          </button>
        </div>
      ) : inDrawer ? (
        <div className="shrink-0 flex items-center gap-2 px-4 py-2 text-sm bg-github-bg-tertiary">
          {title}
        </div>
      ) : (
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
          {title}
        </button>
      )}
      {isListShown && (
        <ul
          ref={listRef}
          onContextMenu={(event) => event.preventDefault()}
          className={`${inDrawer ? 'flex-1' : 'max-h-60'} overflow-y-auto py-1 m-0 list-none p-0 select-none [-webkit-touch-callout:none]`}
        >
          <li>
            <button
              type="button"
              onClick={() => onSelect({ kind: 'all' })}
              aria-current={shown.kind === 'all' ? true : undefined}
              className={`${itemClass} ${shown.kind === 'all' ? CURRENT_CLASS : 'text-github-text-secondary'}`}
            >
              <span className="w-[32px] shrink-0" />
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
                    className={`${MERGED_CLASS} ${rowPadding} ${isCurrent ? CURRENT_MERGED_CLASS : ''}`}
                  >
                    <CommitGraph cell={entry.cell} bleed={graphBleed} />
                    {entry.kind === 'commit' ? (
                      <>
                        <code className="shrink-0 font-mono text-xs">{entry.commit.shortSha}</code>
                        <span className="min-w-0 truncate">{entry.commit.subject}</span>
                        {openCountOf(entry.commit.sha)}
                      </>
                    ) : (
                      <span>커밋 {entry.count}개 더</span>
                    )}
                  </li>
                ))}
                <li>
                  <button
                    type="button"
                    data-commit-sha={commit.sha}
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
                    onTouchStart={(event) => startPress(commit.sha, event)}
                    onTouchEnd={endPress}
                    onTouchCancel={cancelPress}
                    onClick={(event) =>
                      onSelect({ kind: event.shiftKey ? 'shift-click' : 'click', sha: commit.sha })
                    }
                    aria-current={isCurrent ? true : undefined}
                    data-drag-preview={isPreviewed ? '' : undefined}
                    title={commit.subject}
                    className={`${itemClass} ${isCurrent ? CURRENT_COMMIT_CLASS : 'text-github-text-secondary'} ${isPreviewed ? PREVIEW_CLASS : ''}`}
                  >
                    <CommitGraph cell={cell} bleed={graphBleed} />
                    <code className="shrink-0 font-mono text-xs">{commit.shortSha}</code>
                    <span className="min-w-0 truncate">{commit.subject}</span>
                    {openCountOf(commit.sha)}
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
