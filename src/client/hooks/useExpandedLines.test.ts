import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DiffFile } from '../../types/diff';

import { useExpandedLines } from './useExpandedLines';

function createMockDiffFile(): DiffFile {
  return {
    path: 'src/app.ts',
    status: 'modified',
    additions: 1,
    deletions: 1,
    chunks: [
      {
        header: '@@ -2 +2 @@',
        oldStart: 2,
        oldLines: 1,
        newStart: 2,
        newLines: 1,
        lines: [
          {
            type: 'delete',
            content: 'old changed line',
            oldLineNumber: 2,
          },
          {
            type: 'add',
            content: 'new changed line',
            newLineNumber: 2,
          },
        ],
      },
    ],
  };
}

describe('useExpandedLines', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(global.fetch).mockImplementation((input: string | URL | Request) => {
      const rawUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(rawUrl, 'http://localhost');
      const ref = url.searchParams.get('ref');

      const contentByRef: Record<string, string> = {
        'base-a': 'base a line 1\nold changed line\n',
        'base-b': 'base b line 1\nold changed line\n',
        target: 'target line 1\nnew changed line\n',
      };
      const body = ref ? contentByRef[ref] : undefined;

      if (!body) {
        return Promise.resolve({
          ok: false,
          statusText: `missing fixture for ${rawUrl}`,
          text: async () => '',
        } as Response);
      }

      return Promise.resolve({
        ok: true,
        text: async () => body,
      } as Response);
    });
  });

  it('clears expanded state and refetches content when the revision changes', async () => {
    const file = createMockDiffFile();
    const { result, rerender } = renderHook(
      ({ baseCommitish, targetCommitish, diffIdentity }) =>
        useExpandedLines({
          baseCommitish,
          targetCommitish,
          diffIdentity,
        }),
      {
        initialProps: {
          baseCommitish: 'base-a',
          targetCommitish: 'target',
          diffIdentity: 'diff-a',
        },
      },
    );

    await act(async () => {
      await result.current.expandLines(file, 0, 'up', 1);
    });

    expect(result.current.getMergedChunks(file)[0]?.lines[0]?.content).toBe('base a line 1');

    rerender({
      baseCommitish: 'base-b',
      targetCommitish: 'target',
      diffIdentity: 'diff-b',
    });

    await waitFor(() => {
      expect(result.current.expandedState).toEqual({});
    });

    await act(async () => {
      await result.current.expandLines(file, 0, 'up', 1);
    });

    expect(result.current.getMergedChunks(file)[0]?.lines[0]?.content).toBe('base b line 1');
  });

  it('clears expanded state and refetches content when the diff identity changes', async () => {
    const file = createMockDiffFile();
    let baseAContent = 'base a line 1\nold changed line\n';

    vi.mocked(global.fetch).mockImplementation((input: string | URL | Request) => {
      const rawUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(rawUrl, 'http://localhost');
      const ref = url.searchParams.get('ref');

      const contentByRef: Record<string, string> = {
        'base-a': baseAContent,
        target: 'target line 1\nnew changed line\n',
      };
      const body = ref ? contentByRef[ref] : undefined;

      if (!body) {
        return Promise.resolve({
          ok: false,
          statusText: `missing fixture for ${rawUrl}`,
          text: async () => '',
        } as Response);
      }

      return Promise.resolve({
        ok: true,
        text: async () => body,
      } as Response);
    });

    const { result, rerender } = renderHook(
      ({ diffIdentity }) =>
        useExpandedLines({
          baseCommitish: 'base-a',
          targetCommitish: 'target',
          diffIdentity,
        }),
      {
        initialProps: {
          diffIdentity: 'diff-a',
        },
      },
    );

    await act(async () => {
      await result.current.expandLines(file, 0, 'up', 1);
    });

    expect(result.current.getMergedChunks(file)[0]?.lines[0]?.content).toBe('base a line 1');

    baseAContent = 'base a rewritten line 1\nold changed line\n';

    rerender({
      diffIdentity: 'diff-b',
    });

    await waitFor(() => {
      expect(result.current.expandedState).toEqual({});
    });

    await act(async () => {
      await result.current.expandLines(file, 0, 'up', 1);
    });

    expect(result.current.getMergedChunks(file)[0]?.lines[0]?.content).toBe(
      'base a rewritten line 1',
    );
  });

  it('does not request unavailable blob data for stdin diffs', async () => {
    const file = createMockDiffFile();
    const { result } = renderHook(() =>
      useExpandedLines({
        baseCommitish: 'stdin',
        targetCommitish: 'stdin',
        diffIdentity: 'stdin-diff',
      }),
    );

    await act(async () => {
      await result.current.prefetchFileContent(file);
      await result.current.expandLines(file, 0, 'up', 1);
    });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(result.current.expandedState).toEqual({});
  });
});

describe('useExpandedLines change kinds', () => {
  const chunkAt = (line: number, changeKind: 'comment' | 'whitespace' | 'code') => ({
    header: `@@ -${line} +${line} @@`,
    oldStart: line,
    oldLines: 1,
    newStart: line,
    newLines: 1,
    changeKind,
    lines: [
      { type: 'delete' as const, content: `old ${line}`, oldLineNumber: line },
      { type: 'add' as const, content: `new ${line}`, newLineNumber: line },
    ],
  });

  const fileOf = (...chunks: ReturnType<typeof chunkAt>[]): DiffFile => ({
    path: 'src/two.ts',
    status: 'modified',
    additions: chunks.length,
    deletions: chunks.length,
    chunks,
  });

  const renderExpanded = () =>
    renderHook(() => useExpandedLines({ baseCommitish: 'base', targetCommitish: 'target' }));

  beforeEach(() => {
    vi.mocked(global.fetch).mockImplementation(() =>
      Promise.resolve({ ok: true, text: async () => 'old 1\nkept\nold 3\n' } as Response),
    );
  });

  it.each([
    ['whitespace', 'comment'],
    ['code', 'code'],
  ] as const)('merges a comment chunk with a %s chunk into %s', async (second, merged) => {
    const file = fileOf(chunkAt(1, 'comment'), chunkAt(3, second));
    const { result } = renderExpanded();

    expect(result.current.getMergedChunks(file).map((chunk) => chunk.changeKind)).toEqual([
      'comment',
      second,
    ]);

    await act(async () => {
      await result.current.expandAllBetweenChunks(file, 1, 1);
    });

    expect(result.current.getMergedChunks(file).map((chunk) => chunk.changeKind)).toEqual([merged]);
  });

  it('records where each original chunk sits among the merged lines', async () => {
    const file = fileOf(chunkAt(1, 'code'), chunkAt(3, 'comment'));
    const { result } = renderExpanded();

    expect(result.current.getMergedChunks(file).map((chunk) => chunk.originalLineRanges)).toEqual([
      [{ originalIndex: 0, start: 0, end: 1, changeKind: 'code' }],
      [{ originalIndex: 1, start: 0, end: 1, changeKind: 'comment' }],
    ]);

    await act(async () => {
      await result.current.expandAllBetweenChunks(file, 1, 1);
    });

    const [merged] = result.current.getMergedChunks(file);
    expect(merged?.lines.map((line) => line.content)).toEqual([
      'old 1',
      'new 1',
      'kept',
      'old 3',
      'new 3',
    ]);
    expect(merged?.originalLineRanges).toEqual([
      { originalIndex: 0, start: 0, end: 1, changeKind: 'code' },
      { originalIndex: 1, start: 3, end: 4, changeKind: 'comment' },
    ]);
  });

  it('leaves the lines opened above a lone chunk out of its range', async () => {
    vi.mocked(global.fetch).mockImplementation(() =>
      Promise.resolve({ ok: true, text: async () => 'l1\nl2\nold 3\nl4\nl5\n' } as Response),
    );
    const file = fileOf(chunkAt(3, 'comment'));
    const { result } = renderExpanded();

    await act(async () => {
      await result.current.expandLines(file, 0, 'up', 1);
      await result.current.expandLines(file, 0, 'down', 1);
    });

    const [merged] = result.current.getMergedChunks(file);
    expect(merged?.lines.map((line) => line.content)).toEqual(['l2', 'old 3', 'new 3', 'l4']);
    expect(merged?.originalLineRanges).toEqual([
      { originalIndex: 0, start: 1, end: 2, changeKind: 'comment' },
    ]);
    expect(merged?.hiddenLinesBefore).toBe(1);
    expect(merged?.hiddenLinesAfter).toBe(1);
  });
});
