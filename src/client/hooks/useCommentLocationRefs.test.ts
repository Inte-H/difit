import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CommentLocationRefs } from '../../types/diff';

import { useCommentLocationRefs } from './useCommentLocationRefs';

const REFS: CommentLocationRefs = {
  oldCommit: 'abcdef1',
  newCommit: '1234567',
  pathsChangedOnDisk: [],
  renamedFrom: {},
};

function respondWith(refs: CommentLocationRefs | null) {
  let resolve: () => void = () => {};
  const answered = new Promise<void>((done) => {
    resolve = done;
  });
  vi.mocked(global.fetch).mockImplementationOnce(async () => {
    await answered;
    return { ok: true, json: async () => ({ refs }) } as Response;
  });
  return resolve;
}

describe('useCommentLocationRefs', () => {
  beforeEach(() => {
    vi.mocked(global.fetch).mockReset();
  });

  it('answers null until the read is in and while a later read is under way', async () => {
    const first = respondWith(REFS);
    const { result, rerender } = renderHook(
      ({ refreshKey }) => useCommentLocationRefs('/api/comment-location-refs', refreshKey),
      { initialProps: { refreshKey: 0 } },
    );
    expect(result.current()).toBeNull();

    first();
    await waitFor(() => expect(result.current()).toEqual(REFS));

    const second = respondWith({ ...REFS, pathsChangedOnDisk: ['a.ts'] });
    rerender({ refreshKey: 1 });
    expect(result.current()).toBeNull();

    second();
    await waitFor(() => expect(result.current()?.pathsChangedOnDisk).toEqual(['a.ts']));
  });

  it('reads again when the pointer comes back onto the page', async () => {
    respondWith(REFS)();
    const { result } = renderHook(() => useCommentLocationRefs('/api/comment-location-refs', 0));
    await waitFor(() => expect(result.current()).toEqual(REFS));

    const next = respondWith(null);
    act(() => {
      document.documentElement.dispatchEvent(new MouseEvent('mouseenter'));
    });
    expect(result.current()).toBeNull();
    next();
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
  });

  it('answers null when the server has no refs for the review', async () => {
    respondWith(null)();
    const { result } = renderHook(() => useCommentLocationRefs('/api/comment-location-refs', 0));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    expect(result.current()).toBeNull();
  });
});
