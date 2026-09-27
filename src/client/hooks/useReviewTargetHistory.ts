import { useCallback, useEffect, useRef } from 'react';

import { type DiffSelection } from '../../types/diff';
import { createDiffSelection } from '../../utils/diffSelection';

const HISTORY_STATE_KEY = 'difitReviewTarget';

function selectionFromHistoryState(state: unknown): DiffSelection | null {
  if (typeof state !== 'object' || state === null) return null;
  const entry = (state as Record<string, unknown>)[HISTORY_STATE_KEY];
  if (typeof entry !== 'object' || entry === null) return null;
  const { baseCommitish, targetCommitish, baseMode } = entry as Record<string, unknown>;
  if (typeof baseCommitish !== 'string' || typeof targetCommitish !== 'string') return null;
  return createDiffSelection(
    baseCommitish,
    targetCommitish,
    baseMode === 'merge-base' ? 'merge-base' : undefined,
  );
}

// A page loaded afresh by Back/Forward must show the entry's review, not the one the server last
// switched to. A reload keeps the server's review.
export function reviewTargetRestoredByHistory(): DiffSelection | null {
  const [navigation] = performance.getEntriesByType('navigation');
  if ((navigation as PerformanceNavigationTiming | undefined)?.type !== 'back_forward') return null;
  return selectionFromHistoryState(window.history.state);
}

// The URL stays the same across review targets, so each jump is recorded in history state and
// Back/Forward switch the target the same way the revision selector does.
export function useReviewTargetHistory(
  switchTarget: (selection: DiffSelection) => void,
): (from: DiffSelection, to: DiffSelection) => void {
  const switchTargetRef = useRef(switchTarget);
  switchTargetRef.current = switchTarget;

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      const selection = selectionFromHistoryState(event.state);
      if (selection) switchTargetRef.current(selection);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  return useCallback((from: DiffSelection, to: DiffSelection) => {
    const currentState: unknown = window.history.state;
    window.history.replaceState(
      {
        ...(typeof currentState === 'object' && currentState !== null ? currentState : {}),
        [HISTORY_STATE_KEY]: from,
      },
      '',
    );
    window.history.pushState({ [HISTORY_STATE_KEY]: to }, '');
  }, []);
}
