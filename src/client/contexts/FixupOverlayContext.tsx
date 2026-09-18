import { createContext, useContext, type ReactNode } from 'react';

import type { ReviewDecision, ReviewDecisionKind, ThreadFixup } from '../../types/diff';

export interface FixupOverlayState {
  enabled: boolean;
  fixupsByThread: Map<string, ThreadFixup[]>;
  decisions: ReviewDecision[];
  recordDecision: (threadId: string, kind: ReviewDecisionKind, fixupSha: string) => void;
  undoApproval: (threadId: string) => void;
}

export const EMPTY_FIXUP_OVERLAY: FixupOverlayState = {
  enabled: false,
  fixupsByThread: new Map(),
  decisions: [],
  recordDecision: () => {},
  undoApproval: () => {},
};

const FixupOverlayContext = createContext<FixupOverlayState>(EMPTY_FIXUP_OVERLAY);

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
