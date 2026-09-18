import { createContext, useContext, type ReactNode } from 'react';

import type { ThreadFixup } from '../../types/diff';

export interface FixupOverlayState {
  enabled: boolean;
  fixupsByThread: Map<string, ThreadFixup[]>;
}

const FixupOverlayContext = createContext<FixupOverlayState>({
  enabled: false,
  fixupsByThread: new Map(),
});

export function FixupOverlayProvider({
  value,
  children,
}: {
  value: FixupOverlayState;
  children: ReactNode;
}) {
  return <FixupOverlayContext.Provider value={value}>{children}</FixupOverlayContext.Provider>;
}

export function useFixupOverlay(): FixupOverlayState {
  return useContext(FixupOverlayContext);
}
