import { describe, expect, it } from 'vitest';

import type { DiffLine } from '../../types/diff';

import { type FoldedLines, foldsClearOfForms, NO_FOLDS } from './FoldedLines';

const lines: DiffLine[] = [
  { type: 'normal', content: 'a();', oldLineNumber: 1, newLineNumber: 1 },
  { type: 'delete', content: '// old', oldLineNumber: 2 },
  { type: 'delete', content: '// gone', oldLineNumber: 3 },
  { type: 'add', content: '// new', newLineNumber: 2 },
  { type: 'normal', content: 'b();', oldLineNumber: 4, newLineNumber: 3 },
  { type: 'normal', content: 'c();', oldLineNumber: 5, newLineNumber: 4 },
];

const fold = (start: number, end: number): FoldedLines => ({
  start,
  end,
  label: 'fold',
  onUnfold: () => {},
});

describe('foldsClearOfForms', () => {
  const folds = [fold(1, 3), fold(5, 5)];

  it('returns the same folds when no form is open', () => {
    expect(foldsClearOfForms(folds, lines, null, null)).toBe(folds);
  });

  it('opens a fold that the middle of a comment range passes through', () => {
    expect(foldsClearOfForms(folds, lines, { side: 'new', lineNumber: [1, 3] }, null)).toEqual([
      folds[1],
    ]);
    expect(foldsClearOfForms(folds, lines, { side: 'new', lineNumber: [3, 4] }, null)).toEqual([
      folds[0],
    ]);
  });

  it('matches a comment on the old side by old line numbers', () => {
    expect(foldsClearOfForms(folds, lines, { side: 'old', lineNumber: 5 }, null)).toEqual([
      folds[0],
    ]);
    expect(foldsClearOfForms(folds, lines, { side: 'new', lineNumber: 5 }, null)).toBe(folds);
  });

  it('opens every fold an edit range overlaps', () => {
    expect(foldsClearOfForms(folds, lines, null, { start: 2, end: 4 })).toBe(NO_FOLDS);
  });

  it('keeps folds the edit range does not reach', () => {
    expect(foldsClearOfForms(folds, lines, null, { start: 1, end: 1 })).toBe(folds);
  });
});
