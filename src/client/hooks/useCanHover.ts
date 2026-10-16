import { useSyncExternalStore } from 'react';

import { MEDIA_QUERIES } from '../constants/breakpoints';

const subscribe = (onChange: () => void) => {
  if (typeof window === 'undefined') return () => {};
  const query = window.matchMedia(MEDIA_QUERIES.canHover);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};

const getSnapshot = () =>
  typeof window === 'undefined' ? true : window.matchMedia(MEDIA_QUERIES.canHover).matches;

// True on a mouse or trackpad, false on a touch screen, whatever the window's width.
export function useCanHover(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => true);
}
