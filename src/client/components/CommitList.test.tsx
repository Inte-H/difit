import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom';

import type { ReviewCommit, ReviewView } from '../../types/diff';

import { CommitList } from './CommitList';

const commit = (digit: string, subject: string): ReviewCommit => ({
  sha: digit.repeat(40),
  shortSha: digit.repeat(7),
  parentSha: String(Number(digit) - 1).repeat(40),
  subject,
});
const COMMITS = [
  commit('1', 'pin the old behavior'),
  commit('2', 'change the behavior'),
  commit('3', 'tidy up'),
  commit('4', 'document it'),
];
const REVIEW = {
  requested: { baseCommitish: '0'.repeat(40), targetCommitish: '4'.repeat(40) },
  commits: COMMITS,
};

function renderList(
  shown: ReviewView = { kind: 'all' },
  {
    commits = COMMITS,
    ...options
  }: { rangeStart?: string; inDrawer?: boolean; commits?: ReviewCommit[] } = {},
) {
  const onSelect = vi.fn();
  const review = { ...REVIEW, commits };
  const { rerender } = render(
    <CommitList review={review} shown={shown} onSelect={onSelect} {...options} />,
  );
  return {
    onSelect,
    pickFrom: (rangeStart: string) =>
      rerender(
        <CommitList
          review={review}
          shown={shown}
          onSelect={onSelect}
          {...options}
          rangeStart={rangeStart}
        />,
      ),
  };
}

const list = () => screen.getByRole('list');
const row = (name: RegExp | string) => within(list()).getByRole('button', { name });
const header = () => screen.getByRole('button', { expanded: true });
const painted = () =>
  within(list())
    .getAllByRole('button')
    .filter((item) => item.getAttribute('aria-current') === 'true')
    .map((item) => item.textContent);
const previewed = () =>
  within(list())
    .getAllByRole('button')
    .filter((item) => item.hasAttribute('data-drag-preview'))
    .map((item) => item.textContent?.slice(0, 7));

describe('CommitList', () => {
  it('lists the whole review first and then the commits oldest first', () => {
    renderList();

    expect(
      within(list())
        .getAllByRole('button')
        .map((item) => item.textContent),
    ).toEqual([
      '전체',
      '1111111pin the old behavior',
      '2222222change the behavior',
      '3333333tidy up',
      '4444444document it',
    ]);
  });

  it('marks what is shown and names it in the header', () => {
    renderList({ kind: 'commit', sha: COMMITS[1]!.sha });

    expect(painted()).toEqual(['2222222change the behavior']);
    expect(screen.getByRole('button', { name: '전체' })).not.toHaveAttribute('aria-current');
    expect(header()).toHaveTextContent('2222222 change the behavior');
  });

  it('names the whole review in the header while it is shown', () => {
    renderList();

    expect(screen.getByRole('button', { name: '전체' })).toHaveAttribute('aria-current', 'true');
    expect(header()).toHaveTextContent('커밋 4개전체');
  });

  it('paints the shown run as one block and names its first and last commit in the header', () => {
    renderList({ kind: 'range', startSha: COMMITS[1]!.sha, endSha: COMMITS[2]!.sha });

    expect(painted()).toEqual(['2222222change the behavior', '3333333tidy up']);
    expect(screen.getByRole('button', { name: '전체' })).not.toHaveAttribute('aria-current');
    expect(header()).toHaveTextContent('2222222~3333333 (2개)');
    expect(within(header()).getByTitle('change the behavior ~ tidy up')).toBeInTheDocument();
  });

  it('asks for a click or a Shift+click with the clicked commit, and for the whole review', () => {
    const { onSelect } = renderList({ kind: 'commit', sha: COMMITS[0]!.sha });

    fireEvent.click(row(/2222222/));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'click', sha: COMMITS[1]!.sha });

    fireEvent.click(row(/3333333/), { shiftKey: true });
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'shift-click', sha: COMMITS[2]!.sha });

    fireEvent.click(screen.getByRole('button', { name: '전체' }));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'all' });
  });

  it('paints the run a drop would choose while dragging', () => {
    renderList({ kind: 'commit', sha: COMMITS[0]!.sha });

    fireEvent.mouseDown(row(/3333333/), { button: 0 });
    expect(previewed()).toEqual([]);
    fireEvent.mouseEnter(row(/2222222/));
    expect(previewed()).toEqual(['2222222', '3333333']);

    fireEvent.mouseEnter(row(/4444444/));
    expect(previewed()).toEqual(['3333333', '4444444']);
  });

  it('paints every commit while dragging over a run that covers them all', () => {
    renderList();

    fireEvent.mouseDown(row(/4444444/), { button: 0 });
    fireEvent.mouseEnter(row(/1111111/));

    expect(previewed()).toEqual(['1111111', '2222222', '3333333', '4444444']);
  });

  it('asks for a drop when the mouse is released on another commit', () => {
    const { onSelect } = renderList();

    fireEvent.mouseDown(row(/2222222/), { button: 0 });
    fireEvent.mouseEnter(row(/4444444/));
    fireEvent.mouseUp(row(/4444444/));

    expect(onSelect).toHaveBeenCalledExactlyOnceWith({
      kind: 'drop',
      fromSha: COMMITS[1]!.sha,
      toSha: COMMITS[3]!.sha,
    });
    expect(previewed()).toEqual([]);
  });

  it('drops nothing and paints nothing when released outside the list', () => {
    const { onSelect } = renderList();

    fireEvent.mouseDown(row(/2222222/), { button: 0 });
    fireEvent.mouseEnter(row(/3333333/));
    fireEvent.mouseUp(window);

    expect(previewed()).toEqual([]);
    fireEvent.mouseEnter(row(/4444444/));
    fireEvent.mouseUp(row(/4444444/));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('treats a press and release on the same commit as a click', () => {
    const { onSelect } = renderList();

    fireEvent.mouseDown(row(/2222222/), { button: 0 });
    fireEvent.mouseEnter(row(/3333333/));
    fireEvent.mouseEnter(row(/2222222/));
    fireEvent.mouseUp(row(/2222222/));
    fireEvent.click(row(/2222222/));

    expect(onSelect).toHaveBeenCalledExactlyOnceWith({ kind: 'click', sha: COMMITS[1]!.sha });
  });

  it('starts no drag on a Shift+press', () => {
    renderList();

    fireEvent.mouseDown(row(/2222222/), { button: 0, shiftKey: true });
    fireEvent.mouseEnter(row(/3333333/));

    expect(previewed()).toEqual([]);
  });

  it('shows the open comments of a commit beside it and nothing beside a commit with none', () => {
    render(
      <CommitList
        review={REVIEW}
        shown={{ kind: 'all' }}
        onSelect={vi.fn()}
        openCounts={new Map([[COMMITS[1]!.sha, 2]])}
      />,
    );

    expect(within(row(/2222222/)).getByTitle('열린 지적 2개')).toHaveTextContent('2');
    expect(within(row(/1111111/)).queryByTitle(/^열린 지적/)).not.toBeInTheDocument();
  });

  it('folds the list away and keeps naming what is shown', () => {
    renderList({ kind: 'commit', sha: COMMITS[0]!.sha });

    fireEvent.click(header());

    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { expanded: false })).toHaveTextContent(
      '1111111 pin the old behavior',
    );
  });

  describe('height', () => {
    const region = () => screen.getByRole('region', { name: '리뷰 범위의 커밋' });
    const edge = () => screen.getByRole('separator', { name: '커밋 목록 높이 조절' });

    function renderResizable(height?: number) {
      const onResize = vi.fn();
      const { container } = render(
        <CommitList
          review={REVIEW}
          shown={{ kind: 'all' }}
          onSelect={vi.fn()}
          height={height}
          onResize={onResize}
        />,
      );
      Object.defineProperty(container, 'clientHeight', { value: 600 });
      vi.spyOn(region(), 'getBoundingClientRect').mockReturnValue({ height: 200 } as DOMRect);
      return onResize;
    }

    it('grows as its top edge is dragged up and always leaves the files room', () => {
      const onResize = renderResizable();

      fireEvent.mouseDown(edge(), { clientY: 500 });
      fireEvent.mouseMove(document, { clientY: 450 });
      expect(onResize).toHaveBeenLastCalledWith(250);
      fireEvent.mouseMove(document, { clientY: 0 });
      expect(onResize).toHaveBeenLastCalledWith(440);
      fireEvent.mouseMove(document, { clientY: 900 });
      expect(onResize).toHaveBeenLastCalledWith(80);
      fireEvent.mouseUp(document);
      fireEvent.mouseMove(document, { clientY: 450 });

      expect(onResize).toHaveBeenCalledTimes(3);
    });

    it('takes at most part of the sidebar until a height is chosen, then at most that', () => {
      renderResizable();
      expect(region().style.maxHeight).toBe('40%');

      cleanup();
      renderResizable(300);
      expect(region().style.maxHeight).toContain('300px');
    });

    it('offers no edge to drag once folded', () => {
      renderResizable();

      fireEvent.click(header());

      expect(screen.queryByRole('separator')).not.toBeInTheDocument();
    });
  });

  describe('commit graph', () => {
    const MERGE: ReviewCommit = {
      ...commit('3', 'merge the side branch'),
      merged: [
        { sha: 'a'.repeat(40), shortSha: 'aaaaaaa', subject: 'side first' },
        { sha: 'b'.repeat(40), shortSha: 'bbbbbbb', subject: 'side second' },
      ],
    };
    const WITH_MERGE = [COMMITS[0]!, COMMITS[1]!, MERGE, COMMITS[3]!];
    const dotColors = () =>
      [...list().querySelectorAll('li')]
        .filter((item) => item.querySelector('circle'))
        .map((item) => [
          item.textContent?.slice(0, 7),
          item.querySelector('circle')?.getAttribute('fill'),
        ]);
    const branchRow = (text: string) => within(list()).getByText(text).closest('li')!;

    it('draws a dot on the line for every commit in the colour of the line, whatever is shown', () => {
      renderList({ kind: 'range', startSha: COMMITS[1]!.sha, endSha: COMMITS[2]!.sha });

      expect(dotColors().map(([, color]) => color)).toEqual(
        Array(4).fill('var(--color-github-accent)'),
      );
    });

    it('lists the commits a merge brings in just above it, where they cannot be chosen', () => {
      const { onSelect } = renderList({ kind: 'all' }, { commits: WITH_MERGE });

      expect([...list().querySelectorAll('li')].map((item) => item.textContent)).toEqual([
        '전체',
        '1111111pin the old behavior',
        '2222222change the behavior',
        'aaaaaaaside first',
        'bbbbbbbside second',
        '3333333merge the side branch',
        '4444444document it',
      ]);
      expect(within(branchRow('side first')).queryByRole('button')).not.toBeInTheDocument();

      fireEvent.click(within(list()).getByText('side first'));
      expect(onSelect).not.toHaveBeenCalled();
    });

    it('draws the dots of the branch the same size as the others', () => {
      renderList({ kind: 'all' }, { commits: WITH_MERGE });

      const radii = [...list().querySelectorAll('circle')].map((dot) => dot.getAttribute('r'));
      expect(new Set(radii).size).toBe(1);
      expect(radii).toHaveLength(6);
    });

    it('draws the branch in a colour of its own and marks it shown with its merge', () => {
      renderList({ kind: 'commit', sha: MERGE.sha }, { commits: WITH_MERGE });

      const colors = Object.fromEntries(dotColors());
      expect(colors['aaaaaaa']).toBe('var(--commit-graph-branch-1)');
      expect(colors['bbbbbbb']).toBe('var(--commit-graph-branch-1)');
      expect(colors['3333333']).toBe('var(--color-github-accent)');
      expect(branchRow('side first')).toHaveAttribute('aria-current', 'true');
      expect(painted()).toEqual(['3333333merge the side branch']);
    });

    it('counts the commits of a branch too long to list', () => {
      renderList({ kind: 'all' }, { commits: [COMMITS[0]!, { ...MERGE, mergedOmitted: 30 }] });

      expect(within(list()).getByText('커밋 30개 더')).toBeInTheDocument();
    });
  });
});

describe('CommitList on a phone', () => {
  const at = (y: number) => ({ touches: [{ clientX: 10, clientY: y }] });
  const ended = (y: number) => ({ changedTouches: [{ clientX: 10, clientY: y }] });
  // Rows sit 10px apart from y=10 in this test, the first commit at 10.
  const rowUnder = (y: number) => row(new RegExp(String(y / 10).repeat(7)));

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(document, 'elementFromPoint').mockImplementation((_x, y) => rowUnder(y));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const hold = (y: number) => {
    fireEvent.touchStart(rowUnder(y), at(y));
    act(() => vi.advanceTimersByTime(500));
  };

  it('asks for a click on a short tap', () => {
    const { onSelect } = renderList();

    fireEvent.touchStart(rowUnder(20), at(20));
    act(() => vi.advanceTimersByTime(300));
    fireEvent.touchEnd(rowUnder(20), ended(20));
    fireEvent.click(rowUnder(20));
    act(() => vi.advanceTimersByTime(500));

    expect(onSelect).toHaveBeenCalledExactlyOnceWith({ kind: 'click', sha: COMMITS[1]!.sha });
  });

  it('asks for a long press once the finger is held still, and no click on release', () => {
    const { onSelect } = renderList();

    hold(20);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith({ kind: 'long-press', sha: COMMITS[1]!.sha });

    expect(fireEvent.touchEnd(rowUnder(20), ended(20))).toBe(false);
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('starts no long press when the finger moves away to scroll the list', () => {
    const { onSelect } = renderList();

    fireEvent.touchStart(rowUnder(20), at(20));
    expect(fireEvent.touchMove(rowUnder(20), at(40))).toBe(true);
    act(() => vi.advanceTimersByTime(500));

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('keeps the browser from scrolling, selecting text or opening its menu on a long press', () => {
    const { pickFrom } = renderList();

    hold(20);
    pickFrom(COMMITS[1]!.sha);

    expect(fireEvent.contextMenu(rowUnder(20))).toBe(false);
    expect(fireEvent.touchMove(rowUnder(20), at(30))).toBe(false);
    expect(list()).toHaveClass('select-none', '[-webkit-touch-callout:none]');
  });

  it('paints the run while the held finger drags and asks for a drop where it is lifted', () => {
    const { onSelect, pickFrom } = renderList();

    hold(20);
    pickFrom(COMMITS[1]!.sha);
    expect(previewed()).toEqual(['2222222']);
    fireEvent.touchMove(rowUnder(20), at(40));
    expect(previewed()).toEqual(['2222222', '3333333', '4444444']);
    fireEvent.touchEnd(rowUnder(20), ended(40));

    expect(onSelect).toHaveBeenLastCalledWith({
      kind: 'drop',
      fromSha: COMMITS[1]!.sha,
      toSha: COMMITS[3]!.sha,
    });
  });

  it('asks for nothing more when the held finger is lifted on the commit it pressed', () => {
    const { onSelect, pickFrom } = renderList();

    hold(20);
    pickFrom(COMMITS[1]!.sha);
    fireEvent.touchMove(rowUnder(20), at(30));
    fireEvent.touchMove(rowUnder(20), at(20));
    fireEvent.touchEnd(rowUnder(20), ended(20));

    expect(onSelect).toHaveBeenCalledOnce();
    expect(previewed()).toEqual(['2222222']);
  });

  it('shows that a run is being chosen above the list, with a cancel button', () => {
    const { onSelect } = renderList(
      { kind: 'commit', sha: COMMITS[0]!.sha },
      { rangeStart: COMMITS[2]!.sha },
    );

    expect(screen.getByRole('status')).toHaveTextContent('범위 고르는 중');
    expect(previewed()).toEqual(['3333333']);
    expect(painted()).toEqual(['1111111pin the old behavior']);

    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith({ kind: 'cancel' });
  });

  it('shows no cancel button while no run is being chosen', () => {
    renderList();

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '취소' })).not.toBeInTheDocument();
  });

  it('keeps the list open in a drawer and names what is shown above it', () => {
    renderList({ kind: 'commit', sha: COMMITS[0]!.sha }, { inDrawer: true });

    expect(screen.queryByRole('button', { expanded: true })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: '리뷰 범위의 커밋' })).toHaveTextContent(
      '커밋 4개1111111 pin the old behavior',
    );
    expect(list()).toBeInTheDocument();
  });
});
