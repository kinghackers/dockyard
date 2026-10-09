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
  /**
   * Reload immediately when the surface becomes visible again with stale
   * data (default true). Pass false to keep the previous content frozen —
   * polling then resumes on its normal cadence without a catch-up load
   * (used by the dashboard: switch-back shows what you left, refresh stays
   * manual/live-tick driven).
   */
  catchUp?: boolean;
}

/**
 * Shared polling primitive for pages: runs onLoad on a cadence while active,
 * skips ticks while the document is hidden, and (unless catchUp is false)
 * performs one catch-up load immediately when the surface becomes visible
 * again with stale data instead of waiting for the next tick. With a
 * non-positive interval polling is disabled, but the initial load still runs.
 */
export function usePolling({ active, reloadKey, intervalMs, onLoad, catchUp = true }: PollingOptions) {
  const onLoadRef = useRef(onLoad);
  onLoadRef.current = onLoad;
  const intervalRef = useRef(intervalMs);
  intervalRef.current = intervalMs;
  const catchUpRef = useRef(catchUp);
  catchUpRef.current = catchUp;
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

    const runLoad = async () => {
      if (syncing) return;
      syncing = true;
      try {
        if (!document.hidden) {
          await onLoadRef.current();
          lastLoadedAt.current = Date.now();
        }
      } finally {
        syncing = false;
      }
    };

    const tick = async () => {
      if (stopped) return;
      await runLoad();
      if (!stopped && interval() > 0) timer = setTimeout(() => void tick(), interval());
    };

    const stale = () => interval() > 0 && Date.now() - lastLoadedAt.current >= interval();

    if (interval() <= 0) {
      // polling disabled entirely — still perform the initial load so the
      // page is not blank until the next docker event
      void runLoad();
      return;
    }

    // catch-up on (re)activation: mounted, host switched, or surface visible
    // again; frozen surfaces (catchUp=false) just resume the normal cadence
    if (stale() && catchUpRef.current) void tick();
    else timer = setTimeout(() => void tick(), interval());

    // returning to the app window after a long time away — refresh if stale
    const onVisibility = () => {
      if (!document.hidden && catchUpRef.current && stale() && !syncing) void tick();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [active, reloadKey]);
}
