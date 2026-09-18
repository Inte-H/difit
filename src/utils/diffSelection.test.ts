import { describe, expect, it } from 'vitest';

import { isSameCommit } from './diffSelection';

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
