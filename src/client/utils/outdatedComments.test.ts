import { describe, expect, it } from 'vitest';

import type { DiffCommentThread, DiffFile, DiffLine } from '../../types/diff';

import { buildFileLineIndex, locateThread } from './outdatedComments';

const buildThread = (overrides: Partial<DiffCommentThread> = {}): DiffCommentThread => ({
  id: 'thread-1',
  filePath: 'src/app.ts',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  position: { side: 'new', line: 10 },
  codeSnapshot: { content: 'const value = 1;' },
  messages: [
    {
      id: 'message-1',
      body: 'comment',
      author: 'User',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ],
  ...overrides,
});

const buildFile = (lines: DiffLine[]): DiffFile => ({
  path: 'src/app.ts',
  status: 'modified',
  additions: 0,
  deletions: 0,
  chunks: [
    {
      header: '@@ -1,1 +1,1 @@',
      oldStart: 1,
      oldLines: 1,
      newStart: 1,
      newLines: lines.length,
      lines,
    },
  ],
});

const newLine = (lineNumber: number, content: string): DiffLine => ({
  type: 'add',
  content,
  newLineNumber: lineNumber,
});

const oldLine = (lineNumber: number, content: string): DiffLine => ({
  type: 'delete',
  content,
  oldLineNumber: lineNumber,
});

describe('locateThread', () => {
  it('keeps the stored line when the snapshot still sits there and nowhere else', () => {
    const thread = buildThread({ position: { side: 'new', line: 10 } });
    const index = buildFileLineIndex(buildFile([newLine(10, 'const value = 1;')]));

    expect(locateThread(thread, index, null)).toEqual({ line: 10, isOutdated: false });
  });

  it('moves the thread to where its snapshot now sits when lines were inserted above', () => {
    const thread = buildThread({
      codeSnapshot: { content: 'const a = 1;\nconst b = 2;' },
      position: { side: 'new', line: { start: 10, end: 11 } },
    });
    const index = buildFileLineIndex(
      buildFile([
        newLine(10, 'import x;'),
        newLine(11, 'import y;'),
        newLine(12, 'const a = 1;'),
        newLine(13, 'const b = 2;'),
      ]),
    );

    expect(locateThread(thread, index, null)).toEqual({ line: [12, 13], isOutdated: false });
  });

  it('is outdated at the stored line when the snapshot is gone', () => {
    const thread = buildThread({ position: { side: 'new', line: 10 } });
    const index = buildFileLineIndex(buildFile([newLine(10, 'const value = 2;')]));

    expect(locateThread(thread, index, null)).toEqual({
      line: 10,
      isOutdated: true,
      outdatedReason: 'missing',
    });
  });

  it('is outdated when the snapshot occurs more than once', () => {
    const thread = buildThread({ position: { side: 'new', line: 10 } });
    const index = buildFileLineIndex(
      buildFile([newLine(10, 'const value = 1;'), newLine(20, 'const value = 1;')]),
    );

    expect(locateThread(thread, index, null)).toEqual({
      line: 10,
      isOutdated: true,
      outdatedReason: 'ambiguous',
    });
  });

  it('trusts the stored line of a repeated snapshot while viewing the commit it was made on', () => {
    const fullHash = 'b7c2e10' + '0'.repeat(33);
    const thread = buildThread({
      position: { side: 'new', line: 20 },
      codeSnapshot: { content: '}', commit: fullHash },
    });
    const index = buildFileLineIndex(buildFile([newLine(10, '}'), newLine(20, '}')]));

    expect(locateThread(thread, index, 'b7c2e10')).toEqual({ line: 20, isOutdated: false });
    expect(locateThread(thread, index, '6e4f6d5')).toEqual({
      line: 20,
      isOutdated: true,
      outdatedReason: 'ambiguous',
    });
  });

  it('is outdated when the file is missing from the index map (file no longer in the diff)', () => {
    expect(locateThread(buildThread(), undefined, null)).toEqual({
      line: 10,
      isOutdated: true,
      outdatedReason: 'missing',
    });
  });

  it('keeps a thread without a code snapshot (legacy comment) where it was', () => {
    const thread = buildThread({ codeSnapshot: undefined });
    const index = buildFileLineIndex(buildFile([newLine(10, 'anything')]));

    expect(locateThread(thread, index, null)).toEqual({ line: 10, isOutdated: false });
  });

  it('ignores trailing whitespace and line endings when matching', () => {
    const thread = buildThread({
      codeSnapshot: { content: 'const value = 1;  \r\nconst next = 2;' },
      position: { side: 'new', line: { start: 10, end: 11 } },
    });
    const index = buildFileLineIndex(
      buildFile([newLine(10, 'const value = 1;'), newLine(11, 'const next = 2;')]),
    );

    expect(locateThread(thread, index, null)).toEqual({ line: [10, 11], isOutdated: false });
  });

  it('compares against the "old" side when the thread is anchored to a deletion', () => {
    const thread = buildThread({
      codeSnapshot: { content: 'const removed = true;' },
      position: { side: 'old', line: 42 },
    });
    const changed = buildFileLineIndex(buildFile([oldLine(42, 'const removed = false;')]));
    const same = buildFileLineIndex(buildFile([oldLine(42, 'const removed = true;')]));

    expect(locateThread(thread, changed, null).isOutdated).toBe(true);
    expect(locateThread(thread, same, null)).toEqual({ line: 42, isOutdated: false });
  });

  it('does not confuse "old" and "new" line numbers when both sides exist', () => {
    const thread = buildThread({
      codeSnapshot: { content: 'old-side text' },
      position: { side: 'old', line: 5 },
    });
    const index = buildFileLineIndex(
      buildFile([{ type: 'normal', content: 'new-side text', oldLineNumber: 5, newLineNumber: 5 }]),
    );

    expect(locateThread(thread, index, null).isOutdated).toBe(true);
  });
});
