import { describe, expect, it } from 'vitest';

import {
  isCommitHash,
  isSameCommit,
  isViewOfReview,
  reviewCommitViewed,
  selectionAtCommit,
} from './diffSelection';

describe('isSameCommit', () => {
  const full = 'b7c2e10a9f' + '0'.repeat(30);

  it('matches a short hash against the full hash it abbreviates', () => {
    expect(isSameCommit('b7c2e10', full)).toBe(true);
    expect(isSameCommit(full, 'B7C2E10')).toBe(true);
  });

  it('rejects hashes that differ within the shorter length', () => {
    expect(isSameCommit('b7c2e11', full)).toBe(false);
  });

  it('compares non-hash refs exactly', () => {
    expect(isSameCommit('main', 'main')).toBe(true);
    expect(isSameCommit('main', 'mainline')).toBe(false);
  });
});

describe('selectionAtCommit', () => {
  it('reviews the commit against its own parent when the current review covers one commit', () => {
    expect(
      selectionAtCommit({ baseCommitish: 'b7c2e10^', targetCommitish: 'b7c2e10' }, '6e4f6d5'),
    ).toEqual({ baseCommitish: '6e4f6d5^', targetCommitish: '6e4f6d5' });
  });

  it('keeps the base of a review that spans a range', () => {
    expect(
      selectionAtCommit(
        { baseCommitish: 'main', targetCommitish: 'feature', baseMode: 'merge-base' },
        '6e4f6d5',
      ),
    ).toEqual({ baseCommitish: 'main', targetCommitish: '6e4f6d5', baseMode: 'merge-base' });
  });
});

describe('isCommitHash', () => {
  it('accepts abbreviated and full hashes and rejects refs', () => {
    expect(isCommitHash('b7c2e10')).toBe(true);
    expect(isCommitHash('b7c2e10a9f' + '0'.repeat(30))).toBe(true);
    expect(isCommitHash('HEAD')).toBe(false);
    expect(isCommitHash('main')).toBe(false);
    expect(isCommitHash('b7c2e10^')).toBe(false);
  });
});

describe('views of a review', () => {
  const sha = (digit: string) => digit.repeat(40);
  const commits = [
    { sha: sha('1'), shortSha: '1111111', parentSha: sha('0'), subject: 'first' },
    { sha: sha('2'), shortSha: '2222222', parentSha: sha('1'), subject: 'second' },
    { sha: sha('4'), shortSha: '4444444', parentSha: sha('3'), subject: 'after a fixup' },
  ];
  const review = {
    selection: { baseCommitish: '0000000', targetCommitish: '4444444' },
    commits,
  };

  it('counts the review itself and each of its commits as views of it', () => {
    expect(isViewOfReview(review.selection, review)).toBe(true);
    expect(isViewOfReview({ baseCommitish: '1111111', targetCommitish: '2222222' }, review)).toBe(
      true,
    );
    expect(isViewOfReview({ baseCommitish: '3333333', targetCommitish: '4444444' }, review)).toBe(
      true,
    );
  });

  it('counts a run of its commits as a view of it', () => {
    expect(isViewOfReview({ baseCommitish: '0000000', targetCommitish: '2222222' }, review)).toBe(
      true,
    );
    expect(isViewOfReview({ baseCommitish: '1111111', targetCommitish: '4444444' }, review)).toBe(
      true,
    );
  });

  it('does not count a pair that leaves the range or runs backwards', () => {
    expect(isViewOfReview({ baseCommitish: 'fffffff', targetCommitish: '2222222' }, review)).toBe(
      false,
    );
    expect(isViewOfReview({ baseCommitish: '2222222', targetCommitish: '5555555' }, review)).toBe(
      false,
    );
    expect(isViewOfReview({ baseCommitish: '3333333', targetCommitish: '2222222' }, review)).toBe(
      false,
    );
    expect(
      isViewOfReview(
        { baseCommitish: '1111111', targetCommitish: '2222222', baseMode: 'merge-base' },
        review,
      ),
    ).toBe(false);
  });

  it('names the commit a view shows on its own', () => {
    expect(
      reviewCommitViewed({ baseCommitish: '1111111', targetCommitish: '2222222' }, commits),
    ).toBe(commits[1]);
    expect(reviewCommitViewed(review.selection, commits)).toBeUndefined();
    expect(
      reviewCommitViewed({ baseCommitish: '0000000', targetCommitish: '2222222' }, commits),
    ).toBeUndefined();
  });
});
