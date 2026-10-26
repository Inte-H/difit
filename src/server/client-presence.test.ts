import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createClientPresence } from './client-presence.js';

const GRACE_MS = 3000;

describe('createClientPresence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stays quiet while another client is still connected', () => {
    const onAllGone = vi.fn();
    const presence = createClientPresence(onAllGone, GRACE_MS);
    const leaveFirst = presence.join();
    presence.join();

    leaveFirst();
    vi.advanceTimersByTime(GRACE_MS * 10);

    expect(onAllGone).not.toHaveBeenCalled();
  });

  it('reports all clients gone only after the last one has been away for the grace period', () => {
    const onAllGone = vi.fn();
    const presence = createClientPresence(onAllGone, GRACE_MS);
    const leaveFirst = presence.join();
    const leaveSecond = presence.join();

    leaveFirst();
    leaveSecond();
    vi.advanceTimersByTime(GRACE_MS - 1);
    expect(onAllGone).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onAllGone).toHaveBeenCalledTimes(1);
  });

  it('cancels the pending report when a client joins within the grace period', () => {
    const onAllGone = vi.fn();
    const presence = createClientPresence(onAllGone, GRACE_MS);
    const leaveBeforeReload = presence.join();

    leaveBeforeReload();
    vi.advanceTimersByTime(GRACE_MS - 1);
    const leaveAfterReload = presence.join();
    vi.advanceTimersByTime(GRACE_MS * 10);
    expect(onAllGone).not.toHaveBeenCalled();

    leaveAfterReload();
    vi.advanceTimersByTime(GRACE_MS);
    expect(onAllGone).toHaveBeenCalledTimes(1);
  });

  it('counts a client that leaves twice only once', () => {
    const onAllGone = vi.fn();
    const presence = createClientPresence(onAllGone, GRACE_MS);
    const leaveFirst = presence.join();
    presence.join();

    leaveFirst();
    leaveFirst();
    vi.advanceTimersByTime(GRACE_MS * 10);

    expect(onAllGone).not.toHaveBeenCalled();
  });

  it('reports all clients gone at most once', () => {
    const onAllGone = vi.fn();
    const presence = createClientPresence(onAllGone, GRACE_MS);
    presence.join()();
    vi.advanceTimersByTime(GRACE_MS);

    presence.join()();
    vi.advanceTimersByTime(GRACE_MS);

    expect(onAllGone).toHaveBeenCalledTimes(1);
  });

  it('never reports once stopped, even with a report already pending', () => {
    const onAllGone = vi.fn();
    const presence = createClientPresence(onAllGone, GRACE_MS);
    presence.join()();

    presence.stop();
    vi.advanceTimersByTime(GRACE_MS);
    presence.join()();
    vi.advanceTimersByTime(GRACE_MS);

    expect(onAllGone).not.toHaveBeenCalled();
  });

  it('tells whether it was stopped before or after reporting', () => {
    const presence = createClientPresence(vi.fn(), GRACE_MS);
    presence.join()();
    expect(presence.stop()).toBe(true);

    const reported = createClientPresence(vi.fn(), GRACE_MS);
    reported.join()();
    vi.advanceTimersByTime(GRACE_MS);
    expect(reported.stop()).toBe(false);
  });

  it('does not report anything before any client has joined', () => {
    const onAllGone = vi.fn();
    createClientPresence(onAllGone, GRACE_MS);

    vi.advanceTimersByTime(GRACE_MS * 10);

    expect(onAllGone).not.toHaveBeenCalled();
  });
});
