import { describe, expect, it } from 'vitest';

import { findScrollVisibleFileIndex } from './scrollVisibleFile';

describe('findScrollVisibleFileIndex', () => {
  const tops = [0, 500, 900];

  it('returns null when there are no files', () => {
    expect(findScrollVisibleFileIndex(0, [])).toBeNull();
  });

  it('picks the file whose section spans the top edge', () => {
    expect(findScrollVisibleFileIndex(0, tops)).toBe(0);
    expect(findScrollVisibleFileIndex(650, tops)).toBe(1);
  });

  it('gives the boundary to the file that starts there', () => {
    expect(findScrollVisibleFileIndex(500, tops)).toBe(1);
  });

  it('treats a file starting within a pixel below the edge as the one at the top', () => {
    expect(findScrollVisibleFileIndex(499.6, [0, 500.4, 900])).toBe(1);
    expect(findScrollVisibleFileIndex(498, [0, 500, 900])).toBe(0);
  });

  it('picks the first file when the top edge is above it', () => {
    expect(findScrollVisibleFileIndex(0, [8, 500])).toBe(0);
  });

  it('picks the last file past its top', () => {
    expect(findScrollVisibleFileIndex(5000, tops)).toBe(2);
  });

  it('skips files without a measured position', () => {
    expect(findScrollVisibleFileIndex(950, [0, Number.NaN, 900])).toBe(2);
    expect(findScrollVisibleFileIndex(600, [0, Number.POSITIVE_INFINITY, 500])).toBe(2);
    expect(findScrollVisibleFileIndex(100, [0, Number.NaN, 900])).toBe(0);
  });
});
