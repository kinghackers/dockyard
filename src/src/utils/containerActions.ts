/** Which lifecycle actions make sense for a container in its current state. */
export interface ContainerActionFlags {
  canStart: boolean;
  canStop: boolean;
  canRestart: boolean;
  canPause: boolean;
  canUnpause: boolean;
  canKill: boolean;
  canRemove: boolean;
  canLogs: boolean;
  canExec: boolean;
  /** Fault restart loop: engine is restarting it, or it has restarted many times. */
  isRestartLoop: boolean;
  /** Transitional / unusable states (removing, unknown). */
  isBusy: boolean;
}

const RESTART_LOOP_THRESHOLD = 3;

export function getContainerActions(
  state: string,
  status?: string,
  restartCount?: number
): ContainerActionFlags {
  const s = (state || '').toLowerCase();
  const st = status || '';
  const busy = s === 'removing' || s === 'removal in progress';
  const restarting = s === 'restarting' || /^restarting\b/i.test(st);
  const running = s === 'running';
  const paused = s === 'paused';
  const stopped = s === 'exited' || s === 'created' || s === 'dead' || s === '';
  const loop =
    restarting ||
    (!busy && (restartCount ?? 0) >= RESTART_LOOP_THRESHOLD && (running || restarting || s === 'exited'));

  return {
    canStart: !busy && !running && !paused && !restarting,
    canStop: !busy && (running || paused || restarting),
    canRestart: !busy && (running || paused),
    canPause: !busy && running,
    canUnpause: !busy && paused,
    canKill: !busy && (running || restarting),
    canRemove: !busy,
    canLogs: !busy,
    canExec: !busy && running,
    isRestartLoop: loop,
    isBusy: busy,
  };
}
