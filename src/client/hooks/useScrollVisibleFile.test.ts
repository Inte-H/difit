import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DiffFile } from '../../types/diff';
import { getFileElementId } from '../utils/domUtils';

import { useScrollVisibleFile } from './useScrollVisibleFile';

const createFile = (path: string): DiffFile => ({
  path,
  status: 'modified',
  additions: 1,
  deletions: 1,
  chunks: [],
});

function stubTop(element: HTMLElement, top: number) {
  element.getBoundingClientRect = () =>
    ({ top, bottom: top + 400, left: 0, right: 0, width: 0, height: 400 }) as DOMRect;
}

function setup(files: DiffFile[], tops: number[]) {
  const container = document.createElement('main');
  stubTop(container, 50);
  document.body.appendChild(container);

  const sections = files.map((file, index) => {
    const section = document.createElement('div');
    section.id = getFileElementId(file.path);
    stubTop(section, 50 + (tops[index] ?? 0));
    container.appendChild(section);
    return section;
  });

  const scrollTo = (scrollTop: number) => {
    container.scrollTop = scrollTop;
    sections.forEach((section, index) => stubTop(section, 50 + (tops[index] ?? 0) - scrollTop));
    act(() => {
      container.dispatchEvent(new Event('scroll'));
    });
  };

  return { container, sections, scrollTo };
}

describe('useScrollVisibleFile', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  const files = [createFile('src/a.ts'), createFile('src/b.ts'), createFile('src/c.ts')];

  it('marks the first file before any scroll', () => {
    const { container } = setup(files, [0, 500, 900]);
    const { result } = renderHook(() =>
      useScrollVisibleFile({ diffScrollContainerRef: { current: container }, files }),
    );

    expect(result.current).toBe(0);
  });

  it('follows the file at the top of the container as it scrolls', async () => {
    const { container, scrollTo } = setup(files, [0, 500, 900]);
    const { result } = renderHook(() =>
      useScrollVisibleFile({ diffScrollContainerRef: { current: container }, files }),
    );

    scrollTo(650);
    await waitFor(() => expect(result.current).toBe(1));

    scrollTo(1200);
    await waitFor(() => expect(result.current).toBe(2));
  });

  it('keeps working when a file section is missing', async () => {
    const { container, sections, scrollTo } = setup(files, [0, 500, 900]);
    sections[1]!.remove();
    const { result } = renderHook(() =>
      useScrollVisibleFile({ diffScrollContainerRef: { current: container }, files }),
    );

    scrollTo(950);
    await waitFor(() => expect(result.current).toBe(2));
  });

  it('returns null without a scroll container', () => {
    const { result } = renderHook(() =>
      useScrollVisibleFile({ diffScrollContainerRef: { current: null }, files }),
    );

    expect(result.current).toBeNull();
  });

  it('returns null without files', () => {
    const { container } = setup([], []);
    const { result } = renderHook(() =>
      useScrollVisibleFile({ diffScrollContainerRef: { current: container }, files: undefined }),
    );

    expect(result.current).toBeNull();
  });

  it('stops listening once unmounted', () => {
    const { container } = setup(files, [0, 500, 900]);
    const addListener = vi.spyOn(container, 'addEventListener');
    const removeListener = vi.spyOn(container, 'removeEventListener');
    const { unmount } = renderHook(() =>
      useScrollVisibleFile({ diffScrollContainerRef: { current: container }, files }),
    );
    const scrollListener = addListener.mock.calls.find(([type]) => type === 'scroll')?.[1];
    expect(scrollListener).toBeDefined();

    unmount();

    expect(removeListener).toHaveBeenCalledWith('scroll', scrollListener);
  });

  it('measures again when the file list changes', async () => {
    const { container, scrollTo } = setup(files, [0, 500, 900]);
    const { result, rerender } = renderHook(
      ({ currentFiles }) =>
        useScrollVisibleFile({
          diffScrollContainerRef: { current: container },
          files: currentFiles,
        }),
      { initialProps: { currentFiles: files } },
    );
    scrollTo(650);
    await waitFor(() => expect(result.current).toBe(1));

    rerender({ currentFiles: [files[1]!, files[2]!] });

    await waitFor(() => expect(result.current).toBe(0));
  });
});
