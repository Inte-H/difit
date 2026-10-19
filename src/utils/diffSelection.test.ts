import { describe, expect, it } from 'vitest';

import {
  bindingForView,
  commitsOfView,
  fixupCommitOf,
  isCommitHash,
  isSameCommit,
  isSameView,
  isViewOfReview,
  madeViewElsewhere,
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

  it('takes a short view and the full hashes it abbreviates as the same view', () => {
    const stored = { baseCommitish: sha('1'), targetCommitish: sha('2') };

    expect(isSameView({ baseCommitish: '1111111', targetCommitish: '2222222' }, stored)).toBe(true);
    expect(isSameView({ baseCommitish: '1111111', targetCommitish: '4444444' }, stored)).toBe(
      false,
    );
    expect(
      isSameView(
        { baseCommitish: '1111111', targetCommitish: '2222222', baseMode: 'merge-base' },
        stored,
      ),
    ).toBe(false);
  });

  it('lists the commits each view of the review shows', () => {
    expect(commitsOfView(review.selection, review)).toEqual(commits);
    expect(commitsOfView({ baseCommitish: '1111111', targetCommitish: '2222222' }, review)).toEqual(
      [commits[1]],
    );
    expect(commitsOfView({ baseCommitish: '1111111', targetCommitish: '4444444' }, review)).toEqual(
      commits.slice(1),
    );
    expect(commitsOfView({ baseCommitish: 'fffffff', targetCommitish: '2222222' }, review)).toEqual(
      [],
    );
  });

  it('binds a comment made on one commit to that commit by its full hashes', () => {
    expect(
      bindingForView(review, { baseCommitish: '1111111', targetCommitish: '2222222' }),
    ).toEqual({
      view: { baseCommitish: sha('1'), targetCommitish: sha('2') },
      fixupTarget: sha('2'),
      snapshotCommit: sha('2'),
    });
  });

  it('binds nothing to a comment made on the whole review or a run of commits', () => {
    expect(bindingForView(review, review.selection)).toBeUndefined();
    expect(
      bindingForView(review, { baseCommitish: '0000000', targetCommitish: '2222222' }),
    ).toBeUndefined();

    const oneCommitReview = {
      selection: { baseCommitish: '0000000', targetCommitish: '1111111' },
      commits: commits.slice(0, 1),
    };
    expect(bindingForView(oneCommitReview, oneCommitReview.selection)).toBeUndefined();
  });

  describe('the view a comment was made on', () => {
    const requested = { baseCommitish: sha('0'), targetCommitish: sha('4') };
    const scope = { ...review, requested };
    const onSecond = { view: { baseCommitish: sha('1'), targetCommitish: sha('2') } };

    it('is the commit it was made on, while another view is shown', () => {
      expect(madeViewElsewhere(onSecond, review.selection, scope)).toBe(onSecond.view);
      expect(
        madeViewElsewhere(
          onSecond,
          { baseCommitish: '1111111', targetCommitish: '2222222' },
          scope,
        ),
      ).toBeUndefined();
    });

    it('is the whole review as requested for a comment that names no view', () => {
      const onCommit = { baseCommitish: '1111111', targetCommitish: '2222222' };
      expect(madeViewElsewhere({}, onCommit, scope)).toBe(requested);
      expect(madeViewElsewhere({}, review.selection, scope)).toBeUndefined();
    });

    it('is nothing for a view outside the review', () => {
      const elsewhere = { view: { baseCommitish: sha('7'), targetCommitish: sha('8') } };
      expect(madeViewElsewhere(elsewhere, review.selection, scope)).toBeUndefined();
    });
  });

  it('names the commit a fix goes into by its short hash and subject', () => {
    expect(fixupCommitOf(sha('2'), commits)).toEqual({ shortSha: '2222222', subject: 'second' });
    expect(fixupCommitOf(sha('9'), commits)).toEqual({ shortSha: '9999999' });
  });
});
