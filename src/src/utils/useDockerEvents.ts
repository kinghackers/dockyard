import { useEffect, useRef } from 'react';
import { useAppStore } from '../stores/appStore';
import { loadUiPref } from './uiPrefs';
import type { DockerEvent } from '../types/docker';
import { t, useT } from '../i18n';

/** Events that mean a list (containers / images / networks / volumes) should refresh. */
const REFRESH_ACTIONS = new Set([
  'create',
  'start',
  'stop',
  'die',
  'destroy',
  'kill',
  'pause',
  'unpause',
  'restart',
  'rename',
  'update',
  'connect',
  'disconnect',
  'pull',
  'tag',
  'untag',
  'delete',
  'load',
  'import',
  'volume.create',
  'volume.destroy',
  'volume.mount',
  'volume.unmount',
  'network.create',
  'network.destroy',
  'network.connect',
  'network.disconnect',
]);

/**
 * Health-check probes (and our own terminal sessions) surface as exec_create /
 * exec_start / exec_die — up to 3 events per probe per container, which floods
 * the dashboard "最近事件" feed. They are pure noise; health_status transitions
 * (the actual healthy/unhealthy changes) still pass through.
 */
const NOISE_EVENT_PREFIXES = ['exec_'];

function isNoiseEvent(e: DockerEvent) {
  return NOISE_EVENT_PREFIXES.some((p) => e.action.startsWith(p));
}

/** Minimum interval between "event stream failed" toasts, per host. */
const STREAM_ERROR_TOAST_MS = 60_000;

/**
 * Docker emits `kill` (signal 15/9) and/or `stop` right before `die` when a
 * container is stopped deliberately (UI button, `docker stop`, `docker kill`).
 * A crash has no such preceding event. Manual stops very commonly exit with
 * 143 (SIGTERM) / 137 (SIGKILL) — that is normal, not abnormal.
 */
const DELIBERATE_STOP_WINDOW_MS = 15_000;

/**
 * Subscribes to docker events for every connected host and bumps
 * `containersVersion` so list/tree views auto-refresh.
 */
export function useDockerEvents() {
  const connections = useAppStore((s) => s.connections);
  const statuses = useAppStore((s) => s.statuses);
  const bumpContainers = useAppStore((s) => s.bumpContainers);
  const pushEvent = useAppStore((s) => s.pushEvent);
  const openHostsRef = useRef<Set<string>>(new Set());
  const streamErrorAtRef = useRef<Record<string, number>>({});
  /** `${hostId}:${containerId/name}` → timestamp of the last deliberate kill/stop */
  const deliberateStopAtRef = useRef<Record<string, number>>({});

  const connectedIds = connections
    .filter((c) => statuses[c.id]?.connected)
    .map((c) => c.id)
    .sort()
    .join(',');

  useEffect(() => {
    const wanted = connectedIds ? connectedIds.split(',').filter(Boolean) : [];
    const open = openHostsRef.current;
    let cancelled = false;

    const handleEvent = (e: DockerEvent) => {
      if (!isNoiseEvent(e)) {
        pushEvent({
          hostId: e.hostId,
          type: e.type,
          action: e.action,
          name: e.name,
          time: e.time || Date.now(),
        });
      }
      // OS notification when a container exits abnormally (opt-out in settings).
      // Suppress when the die was preceded by a deliberate stop/kill — manual
      // stops routinely exit 143/137 which is not a crash.
      if (e.type === 'container') {
        const stopKey = (k: string) => `${e.hostId}:${k}`;
        if (e.action === 'kill' || e.action === 'stop') {
          if (e.id) deliberateStopAtRef.current[stopKey(e.id)] = Date.now();
          if (e.name) deliberateStopAtRef.current[stopKey(e.name)] = Date.now();
        }
        if (
          e.action === 'die' &&
          loadUiPref('settings.notifyAbnormalExit', true)
        ) {
          const exitCode = e.attributes?.exitCode;
          const oom = e.attributes?.OOMKilled === 'true' || e.attributes?.oomKilled === 'true';
          const stoppedDeliberately =
            !oom &&
            [e.id, e.name]
              .filter(Boolean)
              .some((k) => Date.now() - (deliberateStopAtRef.current[stopKey(String(k))] || 0) < DELIBERATE_STOP_WINDOW_MS);
          if (!stoppedDeliberately && exitCode !== undefined && String(exitCode) !== '0' && e.name) {
            window.dockerApi.notify(t("容器异常退出：{p0}", { p0: e.name }), t("退出码 {p0}", { p0: exitCode }));
          }
        }
      }
      if (REFRESH_ACTIONS.has(e.action) || REFRESH_ACTIONS.has(`${e.type}.${e.action}`)) {
        bumpContainers();
      }
    };

    // the stream auto-reconnects; only tell the user when failures persist
    const handleStreamError = ({ hostId, error }: { hostId: string; error: string }) => {
      const last = streamErrorAtRef.current[hostId] || 0;
      const now = Date.now();
      if (now - last < STREAM_ERROR_TOAST_MS) return;
      streamErrorAtRef.current[hostId] = now;
      const name = useAppStore.getState().connections.find((c) => c.id === hostId)?.name || hostId;
      useAppStore.getState().toast(t("事件流中断，正在自动重连（{p0}）：{p1}", { p0: name, p1: error }), 'error');
    };

    // one shared listener — openEvents streams all feed the same channel
    const off = window.dockerApi.onDockerEvent(handleEvent);
    const offErr = window.dockerApi.onEventError(handleStreamError);

    (async () => {
      for (const id of wanted) {
        if (open.has(id) || cancelled) continue;
        open.add(id);
        try {
          await window.dockerApi.openEvents(id);
          if (cancelled) {
            void window.dockerApi.closeEvents(id);
            open.delete(id);
          }
        } catch {
          open.delete(id);
        }
      }

      // close hosts that are no longer connected
      for (const id of [...open]) {
        if (wanted.includes(id)) continue;
        try {
          await window.dockerApi.closeEvents(id);
        } catch {
          /* ignore */
        }
        open.delete(id);
      }
    })();

    return () => {
      cancelled = true;
      off();
      offErr();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectedIds, bumpContainers, pushEvent]);

  // close every event stream when the app unmounts
  useEffect(() => {
    const open = openHostsRef.current;
    return () => {
      for (const id of [...open]) {
        void window.dockerApi.closeEvents(id).catch(() => undefined);
        open.delete(id);
      }
    };
  }, []);
}
