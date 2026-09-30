import { useEffect, useRef } from 'react';
import { useAppStore } from '../stores/appStore';
import type { DockerEvent } from '../types/docker';

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
 * Subscribes to docker events for every connected host and bumps
 * `containersVersion` so list/tree views auto-refresh.
 */
export function useDockerEvents() {
  const connections = useAppStore((s) => s.connections);
  const statuses = useAppStore((s) => s.statuses);
  const bumpContainers = useAppStore((s) => s.bumpContainers);
  const noteEvent = useAppStore((s) => s.noteEvent);
  const pushEvent = useAppStore((s) => s.pushEvent);
  const openHostsRef = useRef<Set<string>>(new Set());

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
      noteEvent(e.hostId, `${e.type}.${e.action}`);
      pushEvent({
        hostId: e.hostId,
        type: e.type,
        action: e.action,
        name: e.name,
        time: e.time || Date.now(),
      });
      if (REFRESH_ACTIONS.has(e.action) || REFRESH_ACTIONS.has(`${e.type}.${e.action}`)) {
        bumpContainers();
      }
    };

    // one shared listener — openEvents streams all feed the same channel
    const off = window.dockerApi.onDockerEvent(handleEvent);

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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectedIds, bumpContainers, noteEvent, pushEvent]);

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
