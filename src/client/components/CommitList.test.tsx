import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom';

import type { ReviewCommit } from '../../types/diff';

import { CommitList, type ShownPart } from './CommitList';

const commit = (digit: string, subject: string): ReviewCommit => ({
  sha: digit.repeat(40),
  shortSha: digit.repeat(7),
  parentSha: '0'.repeat(40),
  subject,
});
const COMMITS = [commit('1', 'pin the old behavior'), commit('2', 'change the behavior')];

function renderList(shown: ShownPart = 'all') {
  const onShowAll = vi.fn();
  const onShowCommit = vi.fn();
  render(
    <CommitList
      commits={COMMITS}
      shown={shown}
      onShowAll={onShowAll}
      onShowCommit={onShowCommit}
    />,
  );
  return { onShowAll, onShowCommit };
}

describe('CommitList', () => {
  it('lists the whole review first and then the commits oldest first', () => {
    renderList();

    const items = within(screen.getByRole('list')).getAllByRole('button');
    expect(items.map((item) => item.textContent)).toEqual([
      '전체',
      '1111111pin the old behavior',
      '2222222change the behavior',
    ]);
  });

  it('marks what is shown and names it in the header', () => {
    renderList(COMMITS[1]!);

    expect(
      within(screen.getByRole('list')).getByRole('button', { name: /2222222/ }),
    ).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: '전체' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('button', { expanded: true })).toHaveTextContent(
      '2222222 change the behavior',
    );
  });

  it('names the whole review in the header while it is shown', () => {
    renderList();

    expect(screen.getByRole('button', { name: '전체' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { expanded: true })).toHaveTextContent('커밋 2개전체');
  });

  it('switches to a commit or back to the whole review on a click', () => {
    const { onShowAll, onShowCommit } = renderList(COMMITS[0]!);

    fireEvent.click(within(screen.getByRole('list')).getByRole('button', { name: /2222222/ }));
    expect(onShowCommit).toHaveBeenCalledWith(COMMITS[1]);

    fireEvent.click(screen.getByRole('button', { name: '전체' }));
    expect(onShowAll).toHaveBeenCalled();
  });

  it('folds the list away and keeps naming what is shown', () => {
    renderList(COMMITS[0]!);

    fireEvent.click(screen.getByRole('button', { expanded: true }));

    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { expanded: false })).toHaveTextContent(
      '1111111 pin the old behavior',
    );
  });
});
