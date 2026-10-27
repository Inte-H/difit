import { describe, expect, it } from 'vitest';

import type { CommentThread, DiffFile } from '../../../types/diff';

import { findCommentPosition, findLinePlacePosition, linePlaceAt } from './positionHelpers';

const mockFiles: DiffFile[] = [
  {
    path: 'file1.js',
    status: 'modified',
    additions: 1,
    deletions: 1,
    chunks: [
      {
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        lines: [
          { type: 'delete', oldLineNumber: 1, content: '- old line' },
          { type: 'add', newLineNumber: 1, content: '+ new line' },
          { type: 'normal', oldLineNumber: 2, newLineNumber: 2, content: '  unchanged' },
        ],
        header: '@@ -1,2 +1,2 @@',
      },
    ],
  },
];

function createThread(side: CommentThread['side']): CommentThread {
  return {
    id: `thread-${side ?? 'none'}`,
    file: 'file1.js',
    line: 1,
    side,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    messages: [],
  };
}

describe('findCommentPosition', () => {
  it('returns the delete line for old-side threads', () => {
    expect(findCommentPosition(createThread('old'), mockFiles)).toEqual({
      fileIndex: 0,
      chunkIndex: 0,
      lineIndex: 0,
      side: 'left',
    });
  });

  it('returns the add line for new-side threads', () => {
    expect(findCommentPosition(createThread('new'), mockFiles)).toEqual({
      fileIndex: 0,
      chunkIndex: 0,
      lineIndex: 1,
      side: 'right',
    });
  });
});

describe('linePlaceAt', () => {
  const at = (lineIndex: number, side: 'left' | 'right') =>
    linePlaceAt({ fileIndex: 0, chunkIndex: 0, lineIndex, side }, mockFiles);

  it('names the old line on the left and the new line on the right', () => {
    expect(at(2, 'left')).toEqual({ file: 'file1.js', line: 2, side: 'old' });
    expect(at(2, 'right')).toEqual({ file: 'file1.js', line: 2, side: 'new' });
  });

  it('falls back to the number the line has', () => {
    expect(at(0, 'right')).toEqual({ file: 'file1.js', line: 1, side: 'old' });
    expect(at(1, 'left')).toEqual({ file: 'file1.js', line: 1, side: 'new' });
  });

  it('finds the same position again from the place', () => {
    for (const [lineIndex, side] of [
      [0, 'left'],
      [1, 'right'],
      [2, 'right'],
    ] as const) {
      const place = at(lineIndex, side)!;
      expect(findLinePlacePosition(place, mockFiles)).toEqual({
        fileIndex: 0,
        chunkIndex: 0,
        lineIndex,
        side,
      });
    }
  });
});
