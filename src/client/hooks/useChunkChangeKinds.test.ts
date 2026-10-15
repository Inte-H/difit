import { act, renderHook, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DiffFile, DiffResponse } from '../../types/diff';

import { useChunkChangeKinds } from './useChunkChangeKinds';

const file = (
  path: string,
  headers: string[],
  status: DiffFile['status'] = 'modified',
): DiffFile => ({
  path,
  status,
  additions: 1,
  deletions: 1,
  chunks: headers.map((header) => ({
    header,
    oldStart: 1,
    oldLines: 1,
    newStart: 1,
    newLines: 1,
    lines: [],
  })),
});

const diff = (files: DiffFile[]): DiffResponse => ({
  commit: 'a..b',
  files,
  ignoreWhitespace: true,
  requestedBaseCommitish: 'main',
  requestedTargetCommitish: 'topic',
});

function renderKinds(initial: DiffResponse, rendered: string[]) {
  return renderHook(() => {
    const [diffData, setDiffData] = useState<DiffResponse | null>(initial);
    useChunkChangeKinds({ diffData, renderedFilePaths: new Set(rendered), setDiffData });
    return diffData;
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useChunkChangeKinds', () => {
  it('asks once for each rendered file and puts the kinds on matching chunks', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const path = decodeURIComponent(url.split('/api/change-kinds/')[1]!.split('?')[0]!);
      return new Response(
        JSON.stringify({
          path,
          chunks: [
            { header: '@@ -1 +1 @@', changeKind: 'comment' },
            { header: '@@ -9 +9 @@', changeKind: 'code' },
          ],
        }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result, rerender } = renderKinds(
      diff([
        file('src/a.ts', ['@@ -1 +1 @@', '@@ -9 +9 @@']),
        file('src/stale.ts', ['@@ -2 +2 @@', '@@ -9 +9 @@']),
        file('src/new.ts', ['@@ -0,0 +1 @@'], 'added'),
        file('src/later.ts', ['@@ -1 +1 @@']),
      ]),
      ['src/a.ts', 'src/stale.ts', 'src/new.ts'],
    );

    await waitFor(() => {
      expect(result.current?.files[0]?.chunks.map((chunk) => chunk.changeKind)).toEqual([
        'comment',
        'code',
      ]);
    });
    rerender();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/change-kinds/src%2Fa.ts?ignoreWhitespace=true&base=main&target=topic',
    );
    expect(result.current?.files[1]?.chunks.map((chunk) => chunk.changeKind)).toEqual([
      undefined,
      undefined,
    ]);
  });

  it('asks again when the diff is loaded again, and not for a file it cannot classify', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            path: 'src/a.ts',
            chunks: [{ header: '@@ -1 +1 @@', changeKind: 'comment' }],
          }),
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const load = () => diff([file('src/a.ts', ['@@ -1 +1 @@'])]);
    const { result } = renderHook(() => {
      const [diffData, setDiffData] = useState<DiffResponse | null>(load());
      useChunkChangeKinds({ diffData, renderedFilePaths: new Set(['src/a.ts']), setDiffData });
      return { diffData, setDiffData };
    });
    await waitFor(() => {
      expect(result.current.diffData?.files[0]?.chunks[0]?.changeKind).toBe('comment');
    });

    act(() => result.current.setDiffData(load()));
    await waitFor(() => {
      expect(result.current.diffData?.files[0]?.chunks[0]?.changeKind).toBe('comment');
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify({ path: 'src/a.ts', chunks: [{ header: '@@ -1 +1 @@' }] })),
    );
    act(() => result.current.setDiffData(load()));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('asks nothing for a diff read from stdin', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    renderKinds({ ...diff([file('a.ts', ['@@ -1 +1 @@'])]), targetCommitish: 'stdin' }, ['a.ts']);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
