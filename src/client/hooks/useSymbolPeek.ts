import { useCallback, useEffect, useState } from 'react';
import { useHotkeysContext } from 'react-hotkeys-hook';

import type { SymbolIndexStatus } from '../../types/watch';
import {
  type ReviewRefs,
  type SymbolPeekRequest,
  symbolRequestFromTarget,
} from '../utils/symbolPeek';

export interface SymbolPeekOffer {
  request: SymbolPeekRequest;
  x: number;
  y: number;
}

// The last index change heard for each commit. `seq` counts every change heard, so a window can
// tell whether a change came after it last searched.
export interface SymbolIndexUpdates {
  seq: number;
  byCommit: ReadonlyMap<string, { status: SymbolIndexStatus; seq: number }>;
}

export const NO_INDEX_UPDATES: SymbolIndexUpdates = { seq: 0, byCommit: new Map() };

export function useSymbolPeek({ base, target, enabled }: ReviewRefs & { enabled: boolean }) {
  const { enableScope, disableScope } = useHotkeysContext();
  const [offer, setOffer] = useState<SymbolPeekOffer | null>(null);
  const [stack, setStack] = useState<SymbolPeekRequest[]>([]);
  const [indexUpdates, setIndexUpdates] = useState(NO_INDEX_UPDATES);
  const isOpen = stack.length > 0;

  const noteIndexChange = useCallback((commit: string, status: SymbolIndexStatus) => {
    setIndexUpdates((current) => {
      const seq = current.seq + 1;
      const byCommit = new Map(current.byCommit);
      byCommit.set(commit, { status, seq });
      return { seq, byCommit };
    });
  }, []);

  const open = useCallback((request: SymbolPeekRequest) => {
    setOffer(null);
    setStack((current) => [...current, request]);
  }, []);
  const back = useCallback(() => setStack((current) => current.slice(0, -1)), []);
  const close = useCallback(() => setStack([]), []);

  useEffect(() => {
    if (!isOpen) return;
    disableScope('navigation');
    return () => enableScope('navigation');
  }, [isOpen, enableScope, disableScope]);

  useEffect(() => {
    if (!enabled) {
      setOffer(null);
      return;
    }
    const handleClick = (event: MouseEvent) => {
      const request = event.shiftKey
        ? null
        : symbolRequestFromTarget(event.target, { base, target });
      if (!request) {
        setOffer(null);
        return;
      }
      const selected = window.getSelection()?.toString() ?? '';
      if (selected !== '' && selected.trim() !== request.name) {
        setOffer(null);
        return;
      }
      if (event.metaKey || event.ctrlKey) {
        event.preventDefault();
        open(request);
        return;
      }
      setOffer({ request, x: event.clientX, y: event.clientY });
    };
    const dismiss = () => setOffer(null);
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };

    document.addEventListener('click', handleClick);
    document.addEventListener('scroll', dismiss, true);
    document.addEventListener('keydown', dismissOnEscape);
    return () => {
      document.removeEventListener('click', handleClick);
      document.removeEventListener('scroll', dismiss, true);
      document.removeEventListener('keydown', dismissOnEscape);
    };
  }, [enabled, base, target, open]);

  return { offer, stack, open, back, close, indexUpdates, noteIndexChange };
}
