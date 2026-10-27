import { describe, expect, it } from 'vitest';

import { getElementId, positionFromElementId } from './domHelpers';

describe('positionFromElementId', () => {
  it('reads back the position an id was made from in either view', () => {
    const position = { fileIndex: 12, chunkIndex: 3, lineIndex: 40, side: 'left' as const };
    expect(positionFromElementId(getElementId(position, 'split'))).toEqual(position);
    expect(positionFromElementId(getElementId(position, 'unified'))).toEqual({
      ...position,
      side: 'right',
    });
  });

  it('ignores ids that do not name a line', () => {
    expect(positionFromElementId('file-3')).toBeNull();
    expect(positionFromElementId('comment-thread-file-1-chunk-0-line-2')).toBeNull();
  });
});
