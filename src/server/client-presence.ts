export const CLIENT_GONE_GRACE_MS = 3000;

export interface ClientPresence {
  join(): () => void;
  /** Returns false when all clients had already been reported gone. */
  stop(): boolean;
}

export function createClientPresence(onAllGone: () => void, graceMs: number): ClientPresence {
  let connected = 0;
  let pending: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let reported = false;

  const stop = () => {
    stopped = true;
    clearTimeout(pending);
    pending = undefined;
    return !reported;
  };

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
        if (connected === 0 && !stopped) {
          pending = setTimeout(() => {
            stop();
            reported = true;
            onAllGone();
          }, graceMs);
        }
      };
    },
    stop,
  };
}
