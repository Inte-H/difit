import { describe, expect, it } from 'vitest';

import { isCommitHash, isSameCommit, selectionAtCommit } from './diffSelection';

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
