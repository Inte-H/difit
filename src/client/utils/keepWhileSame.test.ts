import { describe, expect, it } from 'vitest';

import { keepWhileSame } from './keepWhileSame';

describe('keepWhileSame', () => {
  const sameId = (a: { id: string }, b: { id: string }) => a.id === b.id;

  it('keeps the previous array while every item is the same', () => {
    const previous = [{ id: 'a' }, { id: 'b' }];

    expect(keepWhileSame(previous, [{ id: 'a' }, { id: 'b' }], sameId)).toBe(previous);
  });

  it('takes the next array once an item differs or the length changes', () => {
    const previous = [{ id: 'a' }, { id: 'b' }];
    const changed = [{ id: 'a' }, { id: 'c' }];

    expect(keepWhileSame(previous, changed, sameId)).toBe(changed);
    expect(keepWhileSame(previous, previous.slice(1), sameId)).not.toBe(previous);
  });
});
