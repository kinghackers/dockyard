import type { ReactNode } from 'react';
import { Play, Square, RotateCw, Pause, PlayCircle, Skull, AlertTriangle, ShieldOff } from 'lucide-react';
import type { ContainerSummary } from '../../types/docker';
import { getContainerActions } from '../../utils/containerActions';
import { t, useT } from '../../i18n';

export interface ContainerRowActionsProps {
  container: Pick<ContainerSummary, 'state' | 'status'> & { restartCount?: number };
  onStart?: () => void;
  onStop?: () => void;
  onRestart?: () => void;
  onPause?: () => void;
  onUnpause?: () => void;
  onKill?: () => void;
  /** Disable auto-restart + stop — breaks a fault restart loop. */
  onStopRestartLoop?: () => void;
  /** Extra buttons rendered after the state-aware set (e.g. logs / delete). */
  extra?: ReactNode;
}

/**
 * Compact per-row action buttons. Only shows operations that are valid
 * for the container's current lifecycle state.
 */
export function ContainerRowActions({
  container,
  onStart,
  onStop,
  onRestart,
  onPause,
  onUnpause,
  onKill,
  onStopRestartLoop,
  extra,
}: ContainerRowActionsProps) {
  const t = useT();
  const a = getContainerActions(container.state, container.status, container.restartCount);

  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      {a.isRestartLoop && (
        <span
          title={t('检测到频繁自动重启，可停止重启循环')}
          style={{ display: 'inline-flex', color: 'var(--warning)', marginRight: 2 }}
        >
          <AlertTriangle size={13} />
        </span>
      )}
      {a.isRestartLoop && onStopRestartLoop && (
        <button
          className="btn ghost icon-btn"
          title={t('停止重启循环（关闭自动重启并停止）')}
          onClick={(e) => { e.stopPropagation(); onStopRestartLoop(); }}
        >
          <ShieldOff size={12} />
        </button>
      )}
      {a.canStart && onStart && (
        <button className="btn ghost icon-btn" title={t('启动')} onClick={(e) => { e.stopPropagation(); onStart(); }}>
          <Play size={12} />
        </button>
      )}
      {a.canStop && onStop && (
        <button className="btn ghost icon-btn" title={t('停止')} onClick={(e) => { e.stopPropagation(); onStop(); }}>
          <Square size={12} />
        </button>
      )}
      {a.canRestart && onRestart && (
        <button className="btn ghost icon-btn" title={t('重启')} onClick={(e) => { e.stopPropagation(); onRestart(); }}>
          <RotateCw size={12} />
        </button>
      )}
      {a.canPause && onPause && (
        <button className="btn ghost icon-btn" title={t('暂停')} onClick={(e) => { e.stopPropagation(); onPause(); }}>
          <Pause size={12} />
        </button>
      )}
      {a.canUnpause && onUnpause && (
        <button className="btn ghost icon-btn" title={t('恢复')} onClick={(e) => { e.stopPropagation(); onUnpause(); }}>
          <PlayCircle size={12} />
        </button>
      )}
      {a.canKill && onKill && (
        <button
          className="btn ghost icon-btn"
          title={a.isRestartLoop ? t('强制终止（打断重启循环）') : t('强制终止')}
          onClick={(e) => { e.stopPropagation(); onKill(); }}
        >
          <Skull size={12} />
        </button>
      )}
      {extra}
    </div>
  );
}
