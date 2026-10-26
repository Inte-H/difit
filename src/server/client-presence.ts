export const CLIENT_GONE_GRACE_MS = 3000;

export interface ClientPresence {
  join(): () => void;
  stop(): void;
}

export function createClientPresence(onAllGone: () => void, graceMs: number): ClientPresence {
  let connected = 0;
  let pending: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const stop = () => {
    stopped = true;
    clearTimeout(pending);
    pending = undefined;
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
            onAllGone();
          }, graceMs);
        }
      };
    },
    stop,
  };
}
