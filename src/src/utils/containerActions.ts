/** Which lifecycle actions make sense for a container in its current state. */
import { t, useT } from '../i18n';
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

/** Stop a fault restart loop and return the human-readable toast message. */
export async function stopRestartLoop(hostId: string, containerId: string): Promise<string> {
  const result = await window.dockerApi.stopRestartLoop(hostId, containerId);
  return result === 'killed'
    ? t('已强制终止并关闭自动重启')
    : result === 'stopped'
      ? t('已停止并关闭自动重启')
      : t('已关闭自动重启');
}
