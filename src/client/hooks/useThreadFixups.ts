import { useEffect, useMemo, useRef, useState } from 'react';

import type { FixupsResponse, ThreadFixup } from '../../types/diff';

// Focus and visibilitychange usually fire together on one return to the page.
const RETURN_THROTTLE_MS = 1000;

const sameFixups = (a: ThreadFixup[], b: ThreadFixup[]) =>
  a.length === b.length &&
  a.every(
    (fixup, index) =>
      fixup.sha === b[index]?.sha &&
      fixup.patchId === b[index]?.patchId &&
      fixup.threadIds.join() === b[index]?.threadIds.join(),
  );

// Also re-reads the list whenever the page comes back into view.
export function useThreadFixups(
  fixupsApiUrl: string | null,
  refreshKey: number,
): Map<string, ThreadFixup[]> {
  const [fixups, setFixups] = useState<ThreadFixup[]>([]);
  const [returnCount, setReturnCount] = useState(0);
  const lastReturnAtRef = useRef(0);
  const loadedUrlRef = useRef<string | null>(null);

  useEffect(() => {
    const handleReturn = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastReturnAtRef.current < RETURN_THROTTLE_MS) return;
      lastReturnAtRef.current = now;
      setReturnCount((count) => count + 1);
    };
    window.addEventListener('focus', handleReturn);
    document.addEventListener('visibilitychange', handleReturn);
    return () => {
      window.removeEventListener('focus', handleReturn);
      document.removeEventListener('visibilitychange', handleReturn);
    };
  }, []);

  useEffect(() => {
    if (!fixupsApiUrl) {
      loadedUrlRef.current = null;
      setFixups([]);
      return;
    }

    let cancelled = false;
    lastReturnAtRef.current = Date.now();
    fetch(fixupsApiUrl)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Failed to fetch fixups: ${response.status} ${response.statusText}`);
        }
        const payload = (await response.json()) as FixupsResponse;
        if (!cancelled) {
          loadedUrlRef.current = fixupsApiUrl;
          const next = Array.isArray(payload.fixups) ? payload.fixups : [];
          setFixups((current) => (sameFixups(current, next) ? current : next));
        }
      })
      .catch((error) => {
        console.error('Error fetching fixups:', error);
        // A failed refresh of the same review keeps the last list.
        if (!cancelled && loadedUrlRef.current !== fixupsApiUrl) {
          setFixups([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [fixupsApiUrl, refreshKey, returnCount]);

  return useMemo(() => {
    const map = new Map<string, ThreadFixup[]>();
    fixups.forEach((fixup) => {
      fixup.threadIds.forEach((threadId) => {
        const entry = map.get(threadId);
        if (entry) {
          entry.push(fixup);
        } else {
          map.set(threadId, [fixup]);
        }
      });
    });
    return map;
  }, [fixups]);
}
