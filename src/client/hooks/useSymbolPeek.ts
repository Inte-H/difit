import { useCallback, useEffect, useState } from 'react';
import { useHotkeysContext } from 'react-hotkeys-hook';

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

export function useSymbolPeek({ base, target, enabled }: ReviewRefs & { enabled: boolean }) {
  const { enableScope, disableScope } = useHotkeysContext();
  const [offer, setOffer] = useState<SymbolPeekOffer | null>(null);
  const [stack, setStack] = useState<SymbolPeekRequest[]>([]);
  const isOpen = stack.length > 0;

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

  return { offer, stack, open, back, close };
}
