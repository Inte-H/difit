import { describe, expect, it } from 'vitest';

import type { DiffLine } from '../../types/diff';

import { type FoldedLines, lockFoldsUnderForms } from './FoldedLines';

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
  summary: 'fold',
  folded: true,
  onToggle: () => {},
});

const locked = (folded: FoldedLines): FoldedLines => ({ ...folded, folded: false, locked: true });

describe('lockFoldsUnderForms', () => {
  const folds = [fold(1, 3), fold(5, 5)];

  it('returns the same folds when no form is open', () => {
    expect(lockFoldsUnderForms(folds, lines, null, null)).toBe(folds);
  });

  it('locks open a fold that the middle of a comment range passes through', () => {
    expect(lockFoldsUnderForms(folds, lines, { side: 'new', lineNumber: [1, 3] }, null)).toEqual([
      locked(folds[0]!),
      folds[1],
    ]);
    expect(lockFoldsUnderForms(folds, lines, { side: 'new', lineNumber: [3, 4] }, null)).toEqual([
      folds[0],
      locked(folds[1]!),
    ]);
  });

  it('matches a comment on the old side by old line numbers', () => {
    expect(lockFoldsUnderForms(folds, lines, { side: 'old', lineNumber: 5 }, null)).toEqual([
      folds[0],
      locked(folds[1]!),
    ]);
    expect(lockFoldsUnderForms(folds, lines, { side: 'new', lineNumber: 5 }, null)).toBe(folds);
  });

  it('locks open every fold an edit range overlaps', () => {
    expect(lockFoldsUnderForms(folds, lines, null, { start: 2, end: 4 })).toEqual(
      folds.map(locked),
    );
  });

  it('keeps folds the edit range does not reach', () => {
    expect(lockFoldsUnderForms(folds, lines, null, { start: 1, end: 1 })).toBe(folds);
  });

  it('locks a fold the reviewer already opened', () => {
    const opened = { ...fold(1, 3), folded: false };
    expect(lockFoldsUnderForms([opened], lines, { side: 'new', lineNumber: 2 }, null)).toEqual([
      locked(opened),
    ]);
  });
});
