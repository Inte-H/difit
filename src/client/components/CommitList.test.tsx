import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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

function renderList(shown: ReviewView = { kind: 'all' }) {
  const onSelect = vi.fn();
  render(<CommitList review={REVIEW} shown={shown} onSelect={onSelect} />);
  return { onSelect };
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

  it('folds the list away and keeps naming what is shown', () => {
    renderList({ kind: 'commit', sha: COMMITS[0]!.sha });

    fireEvent.click(header());

    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { expanded: false })).toHaveTextContent(
      '1111111 pin the old behavior',
    );
  });
});
