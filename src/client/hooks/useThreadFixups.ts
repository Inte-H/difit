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

interface ThreadFixups {
  fixupsByThread: Map<string, ThreadFixup[]>;
  // False until the list for the current URL has been read at least once.
  loaded: boolean;
}

// Also re-reads the list whenever the page comes back into view.
export function useThreadFixups(fixupsApiUrl: string | null, refreshKey: number): ThreadFixups {
  const [list, setList] = useState<{ url: string; fixups: ThreadFixup[] } | null>(null);
  const [returnCount, setReturnCount] = useState(0);
  const lastReturnAtRef = useRef(0);

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
      setList(null);
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
          const next = Array.isArray(payload.fixups) ? payload.fixups : [];
          setList((current) =>
            current?.url === fixupsApiUrl && sameFixups(current.fixups, next)
              ? current
              : { url: fixupsApiUrl, fixups: next },
          );
        }
      })
      .catch((error) => {
        // A failed refresh of the same review keeps the last list.
        console.error('Error fetching fixups:', error);
      });

    return () => {
      cancelled = true;
    };
  }, [fixupsApiUrl, refreshKey, returnCount]);

  const loaded = fixupsApiUrl === null || list?.url === fixupsApiUrl;
  const fixups = loaded ? list?.fixups : undefined;
  const fixupsByThread = useMemo(() => {
    const map = new Map<string, ThreadFixup[]>();
    fixups?.forEach((fixup) => {
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

  return { fixupsByThread, loaded };
}
