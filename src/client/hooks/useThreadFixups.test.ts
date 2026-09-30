import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ThreadFixup } from '../../types/diff';

import { useThreadFixups } from './useThreadFixups';

const fixup = (sha: string): ThreadFixup => ({
  sha,
  shortSha: sha.slice(0, 7),
  patchId: `patch-${sha}`,
  subject: 'fixup! x',
  threadIds: ['t1'],
  files: [],
});

describe('useThreadFixups', () => {
  const fetchMock = vi.fn();
  let now = 0;

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const returnLater = (event: 'focus' | 'visibilitychange') => {
    now += 2000;
    returnNow(event);
  };

  const returnNow = (event: 'focus' | 'visibilitychange') => {
    act(() => {
      const target = event === 'focus' ? window : document;
      target.dispatchEvent(new Event(event));
    });
  };

  const respondWith = (fixups: ThreadFixup[]) =>
    fetchMock.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ fixups }) });

  it('picks up a fixup committed while the page was in the background', async () => {
    respondWith([]);
    const { result } = renderHook(() => useThreadFixups('/api/fixups', 0));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(result.current.fixupsByThread.size).toBe(0);

    respondWith([fixup('a'.repeat(40))]);
    returnLater('focus');

    await waitFor(() => expect(result.current.fixupsByThread.get('t1')).toHaveLength(1));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reads once when focus and visibilitychange arrive together', async () => {
    respondWith([]);
    renderHook(() => useThreadFixups('/api/fixups', 0));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    respondWith([]);
    respondWith([]);
    returnLater('visibilitychange');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    returnNow('focus');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the last list when a refresh fails', async () => {
    respondWith([fixup('a'.repeat(40))]);
    const { result } = renderHook(() => useThreadFixups('/api/fixups', 0));
    await waitFor(() => expect(result.current.fixupsByThread.get('t1')).toHaveLength(1));

    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, statusText: 'error' });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    returnLater('focus');

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(result.current.fixupsByThread.get('t1')).toHaveLength(1);
  });

  it('does not re-read on a return right after the list was read', async () => {
    respondWith([]);
    renderHook(() => useThreadFixups('/api/fixups', 0));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    returnNow('focus');
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the same map when a re-read returns the same fixups', async () => {
    respondWith([fixup('a'.repeat(40))]);
    const { result } = renderHook(() => useThreadFixups('/api/fixups', 0));
    await waitFor(() => expect(result.current.fixupsByThread.get('t1')).toHaveLength(1));
    const first = result.current.fixupsByThread;

    respondWith([fixup('a'.repeat(40))]);
    returnLater('focus');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(result.current.fixupsByThread).toBe(first);
  });

  it('is not loaded until the list for the current review arrives', async () => {
    let resolve: (value: unknown) => void = () => {};
    fetchMock.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const { result } = renderHook(() => useThreadFixups('/api/fixups', 0));
    expect(result.current.loaded).toBe(false);

    resolve({ ok: true, json: () => Promise.resolve({ fixups: [fixup('a'.repeat(40))] }) });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.fixupsByThread.get('t1')).toHaveLength(1);
  });

  it('shows no fixups from the previous review while the next one is loading', async () => {
    respondWith([fixup('a'.repeat(40))]);
    const { result, rerender } = renderHook(({ url }) => useThreadFixups(url, 0), {
      initialProps: { url: '/api/fixups?target=a' },
    });
    await waitFor(() => expect(result.current.fixupsByThread.get('t1')).toHaveLength(1));

    fetchMock.mockReturnValueOnce(new Promise(() => {}));
    rerender({ url: '/api/fixups?target=b' });

    expect(result.current.loaded).toBe(false);
    expect(result.current.fixupsByThread.size).toBe(0);
  });

  it('counts as loaded when there is no list to read', () => {
    const { result } = renderHook(() => useThreadFixups(null, 0));
    expect(result.current.loaded).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('re-reads the list when the refresh key changes', async () => {
    respondWith([]);
    const { rerender } = renderHook(({ key }) => useThreadFixups('/api/fixups', key), {
      initialProps: { key: 0 },
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    respondWith([]);
    rerender({ key: 1 });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it('picks up a newer commit on the followed ref while the fixups stay the same', async () => {
    respondWith([]);
    const { result } = renderHook(() => useThreadFixups('/api/fixups', 0));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(result.current.newerTarget).toBeUndefined();

    const newerTarget = { ref: 'HEAD', commit: 'e'.repeat(40), commitCount: 1 };
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ fixups: [], newerTarget }),
    });
    returnLater('focus');

    await waitFor(() => expect(result.current.newerTarget).toEqual(newerTarget));
  });
});
