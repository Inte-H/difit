import { createContext, useContext, type ReactNode } from 'react';

const PickedThreadContext = createContext<string | null>(null);

export function PickedThreadProvider({
  value,
  children,
}: {
  value: string | null;
  children: ReactNode;
}) {
  return <PickedThreadContext.Provider value={value}>{children}</PickedThreadContext.Provider>;
}

// The thread last picked in the comments panel, or null.
export function usePickedThreadId(): string | null {
  return useContext(PickedThreadContext);
}
