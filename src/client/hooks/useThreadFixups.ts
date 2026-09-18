import { useEffect, useMemo, useState } from 'react';

import type { FixupsResponse, ThreadFixup } from '../../types/diff';

export function useThreadFixups(
  fixupsApiUrl: string | null,
  refreshKey: number,
): Map<string, ThreadFixup[]> {
  const [fixups, setFixups] = useState<ThreadFixup[]>([]);

  useEffect(() => {
    if (!fixupsApiUrl) {
      setFixups([]);
      return;
    }

    let cancelled = false;
    fetch(fixupsApiUrl)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Failed to fetch fixups: ${response.status} ${response.statusText}`);
        }
        const payload = (await response.json()) as FixupsResponse;
        if (!cancelled) {
          setFixups(Array.isArray(payload.fixups) ? payload.fixups : []);
        }
      })
      .catch((error) => {
        console.error('Error fetching fixups:', error);
        if (!cancelled) {
          setFixups([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [fixupsApiUrl, refreshKey]);

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
