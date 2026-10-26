// Long enough for a reloaded tab to load the page again and reconnect.
export const CLIENT_GONE_GRACE_MS = 3000;

export interface ClientPresence {
  join(): () => void;
}

export function createClientPresence(onAllGone: () => void, graceMs: number): ClientPresence {
  let connected = 0;
  let pending: ReturnType<typeof setTimeout> | undefined;

  return {
    join() {
      connected += 1;
      clearTimeout(pending);
      pending = undefined;

      let left = false;
      return () => {
        if (left) return;
        left = true;
        connected -= 1;
        if (connected === 0) {
          pending = setTimeout(onAllGone, graceMs);
        }
      };
    },
  };
}
