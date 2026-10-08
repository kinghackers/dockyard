import { useEffect, useRef } from 'react';

export interface PollingOptions {
  /** whether the page is currently the visible surface (keep-alive aware) */
  active: boolean;
  /** change this key to force a fresh load (e.g. hostId/containerId switch) */
  reloadKey?: string | number | undefined;
  /** poll cadence in ms; a function is evaluated on every schedule (allows backoff) */
  intervalMs: number | (() => number);
  /** the load routine — should guard itself against overlapping runs */
  onLoad: () => Promise<unknown> | unknown;
}

/**
 * Shared polling primitive for pages: runs onLoad on a cadence while active,
 * skips ticks while the document is hidden, and performs one catch-up load
 * immediately when the surface becomes visible again with stale data
 * (older than the poll interval) instead of waiting for the next tick.
 */
export function usePolling({ active, reloadKey, intervalMs, onLoad }: PollingOptions) {
  const onLoadRef = useRef(onLoad);
  onLoadRef.current = onLoad;
  const intervalRef = useRef(intervalMs);
  intervalRef.current = intervalMs;
  const lastLoadedAt = useRef(0);

  // switching data source (host / container) invalidates the freshness mark
  useEffect(() => {
    lastLoadedAt.current = 0;
  }, [reloadKey]);

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let syncing = false;

    const interval = () =>
      typeof intervalRef.current === 'function' ? intervalRef.current() : intervalRef.current;

    const tick = async () => {
      if (stopped || syncing) return;
      syncing = true;
      try {
        if (!document.hidden) {
          await onLoadRef.current();
          lastLoadedAt.current = Date.now();
        }
      } finally {
        syncing = false;
      }
      if (!stopped && interval() > 0) timer = setTimeout(() => void tick(), interval());
    };

    const stale = () => interval() > 0 && Date.now() - lastLoadedAt.current >= interval();

    // polling disabled entirely (intervalMs <= 0): rely on events / manual refresh
    if (interval() <= 0) return;

    // catch-up on (re)activation: mounted, host switched, or surface visible again
    if (stale()) void tick();
    else timer = setTimeout(() => void tick(), interval());

    // returning to the app window after a long time away — refresh if stale
    const onVisibility = () => {
      if (!document.hidden && stale() && !syncing) void tick();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [active, reloadKey]);
}
