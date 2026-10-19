import { useEffect, useState } from 'react';

import { type DiffFile } from '../../types/diff';
import { getFileElementId } from '../utils/domUtils';
import { findScrollVisibleFileIndex } from '../utils/scrollVisibleFile';

interface UseScrollVisibleFileOptions {
  diffScrollContainerRef: React.RefObject<HTMLElement | null>;
  files: DiffFile[] | undefined;
}

export function useScrollVisibleFile({
  diffScrollContainerRef,
  files,
}: UseScrollVisibleFileOptions): number | null {
  const [visibleFileIndex, setVisibleFileIndex] = useState<number | null>(null);

  useEffect(() => {
    const container = diffScrollContainerRef.current;
    if (!container || !files || files.length === 0) {
      setVisibleFileIndex(null);
      return;
    }

    const measure = () => {
      const containerTop = container.getBoundingClientRect().top;
      const fileTops = files.map((file) => {
        const section = document.getElementById(getFileElementId(file.path));
        if (!section) return Number.NaN;
        return section.getBoundingClientRect().top - containerTop + container.scrollTop;
      });
      setVisibleFileIndex(findScrollVisibleFileIndex(container.scrollTop, fileTops));
    };

    let frameId: number | null = null;
    const handleScroll = () => {
      if (frameId !== null) return;
      frameId = requestAnimationFrame(() => {
        frameId = null;
        measure();
      });
    };

    measure();
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', handleScroll);
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }
    };
  }, [diffScrollContainerRef, files]);

  return visibleFileIndex;
}
