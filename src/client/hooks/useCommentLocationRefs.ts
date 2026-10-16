import { useCallback, useEffect, useRef } from 'react';

import type { CommentLocationRefs, CommentLocationRefsResponse } from '../../types/diff';

const RETURN_THROTTLE_MS = 1000;

function readRefs(payload: Partial<CommentLocationRefsResponse>): CommentLocationRefs | null {
  const { refs } = payload;
  return refs && Array.isArray(refs.pathsChangedOnDisk) && typeof refs.renamedFrom === 'object'
    ? refs
    : null;
}

// Copies are written on the click, so the refs are read ahead: on a refresh, on a return to the
// page, and when the pointer comes back onto it, which usually happens just before a copy click.
// The getter answers null while a read is under way, before the first one, and when the review has
// no refs, since a mention from an older answer could attach lines that have since changed.
export function useCommentLocationRefs(
  apiUrl: string | null,
  refreshKey: number,
): () => CommentLocationRefs | null {
  const latestRef = useRef<{ url: string; refs: CommentLocationRefs | null } | null>(null);
  const readsRef = useRef(0);
  const apiUrlRef = useRef(apiUrl);
  apiUrlRef.current = apiUrl;

  const read = useCallback(() => {
    const url = apiUrlRef.current;
    latestRef.current = null;
    if (!url) return;

    const id = ++readsRef.current;
    fetch(url)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Failed to fetch comment locations: ${response.status}`);
        }
        const refs = readRefs((await response.json()) as Partial<CommentLocationRefsResponse>);
        if (id === readsRef.current) latestRef.current = { url, refs };
      })
      .catch((error) => {
        console.error('Error fetching comment locations:', error);
      });
  }, []);

  useEffect(() => {
    read();
  }, [apiUrl, refreshKey, read]);

  useEffect(() => {
    let lastReturnAt = 0;
    const handleReturn = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastReturnAt < RETURN_THROTTLE_MS) return;
      lastReturnAt = now;
      read();
    };
    const page = document.documentElement;
    window.addEventListener('focus', handleReturn);
    document.addEventListener('visibilitychange', handleReturn);
    page.addEventListener('mouseenter', handleReturn);
    return () => {
      window.removeEventListener('focus', handleReturn);
      document.removeEventListener('visibilitychange', handleReturn);
      page.removeEventListener('mouseenter', handleReturn);
    };
  }, [read]);

  return useCallback(() => {
    const latest = latestRef.current;
    return latest !== null && latest.url === apiUrlRef.current ? latest.refs : null;
  }, []);
}
