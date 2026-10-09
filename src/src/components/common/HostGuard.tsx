import { useEffect, useRef, useState, useCallback } from 'react';
import { Plug, ServerCrash } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { connectOnce } from '../../utils/connection';
import { t, useT } from '../../i18n';

type Phase = 'connecting' | 'ready' | 'disconnected' | 'error';

/**
 * Guards a host-scoped page: attempts to connect the host on mount,
 * renders a friendly empty state (with connect/retry) when not connected
 * instead of letting child pages throw IPC errors.
 */
export function HostGuard({
  hostId,
  children,
}: {
  hostId: string;
  children: React.ReactNode;
}) {
  const t = useT();
  const connections = useAppStore((s) => s.connections);
  const status = useAppStore((s) => s.statuses[hostId]);
  const setStatus = useAppStore((s) => s.setStatus);
  const conn = connections.find((c) => c.id === hostId);
  const [phase, setPhase] = useState<Phase>(status?.connected ? 'ready' : 'connecting');
  const [error, setError] = useState<string | null>(status?.error || null);
  const [connecting, setConnecting] = useState(false);
  const attempted = useRef(false);

  const connect = useCallback(async () => {
    if (!conn) {
      setPhase('disconnected');
      return;
    }
    setConnecting(true);
    setError(null);
    setPhase('connecting');
    try {
      const st = await connectOnce(hostId);
      setStatus(st);
      if (st.connected) {
        setPhase('ready');
      } else {
        setPhase('disconnected');
        setError(st.error || t('连接失败'));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setPhase('error');
      setError(msg);
    } finally {
      setConnecting(false);
    }
  }, [conn, hostId, setStatus]);

  // auto-connect once on mount when not already connected
  useEffect(() => {
    if (status?.connected) {
      setPhase('ready');
      setError(null);
      return;
    }
    if (attempted.current) return;
    attempted.current = true;
    void connect();
  }, [status?.connected, connect]);

  // when status becomes connected externally (e.g. sidebar connect button)
  useEffect(() => {
    if (status?.connected && phase !== 'ready') {
      setPhase('ready');
      setError(null);
    }
    if (status && !status.connected && status.error && phase === 'ready') {
      setPhase('disconnected');
      setError(status.error);
    }
  }, [status, phase]);

  if (phase === 'ready' && status?.connected) {
    return <>{children}</>;
  }

  return (
    <div className="page">
      <div className="empty-state">
        {phase === 'connecting' || connecting ? (
          <>
            <span className="spinner" style={{ width: 28, height: 28, borderWidth: 3 }} />
            <h3>{t('正在连接')}{conn?.name || hostId}…</h3>
            <p>{t('首次打开会自动建立到 Docker 主机的连接')}</p>
          </>
        ) : (
          <>
            <ServerCrash size={36} strokeWidth={1.2} color="var(--text-muted)" />
            <h3>{t('未连接到')}{conn?.name || hostId}</h3>
            <p style={{ maxWidth: 420, lineHeight: 1.6 }}>
              {error
                ? t("连接失败：{p0}", { p0: error })
                : t('该主机尚未建立连接，请点击下方按钮连接后再管理资源。')}
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className="btn primary" onClick={() => void connect()} disabled={connecting}>
                <Plug size={14} /> {connecting ? t('连接中…') : attempted.current || phase === 'error' ? t('重试连接') : t('立即连接')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
