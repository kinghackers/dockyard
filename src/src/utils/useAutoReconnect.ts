import { useEffect, useRef } from 'react';
import { useAppStore } from '../stores/appStore';
import { loadUiPref } from './uiPrefs';
import { t, useT } from '../i18n';

const MAX_BACKOFF_MS = 60_000;

/**
 * Reconnect hosts that dropped with an error (network blip, sshd restart).
 * Per-host linear backoff (5s × attempt, capped); resets once reconnected.
 * Opt-out via the settings.autoReconnect pref (default on).
 */
export function useAutoReconnect() {
  const connections = useAppStore((s) => s.connections);
  const statuses = useAppStore((s) => s.statuses);
  const attemptsRef = useRef<Record<string, number>>({});
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    if (!loadUiPref('settings.autoReconnect', true)) return;

    for (const c of connections) {
      const st = statuses[c.id];
      if (st?.connected) {
        attemptsRef.current[c.id] = 0;
        continue;
      }
      // only hosts that were connected before and errored — never-connected
      // hosts stay manual (avoid hammering hosts with wrong credentials)
      if (!st?.error) continue;
      if (timersRef.current[c.id]) continue;

      const attempt = (attemptsRef.current[c.id] || 0) + 1;
      attemptsRef.current[c.id] = attempt;
      const delay = Math.min(5000 * attempt, MAX_BACKOFF_MS);
      timersRef.current[c.id] = setTimeout(() => {
        delete timersRef.current[c.id];
        void (async () => {
          try {
            const status = await window.dockerApi.connect(c.id);
            useAppStore.getState().setStatus(status);
            if (status.connected) {
              attemptsRef.current[c.id] = 0;
              useAppStore.getState().toast(t("已自动重连 {p0}", { p0: c.name }), 'success');
            }
          } catch {
            /* failed connect updates statuses → effect reschedules with backoff */
          }
        })();
      }, delay);
    }
  }, [connections, statuses]);

  // clear pending timers on unmount
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const t of Object.values(timers)) clearTimeout(t);
    };
  }, []);
}
