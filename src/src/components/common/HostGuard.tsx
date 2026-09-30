import { useEffect, useRef, useState, useCallback } from 'react';
import { Plug, RefreshCw, ServerCrash } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { connectOnce } from '../../utils/connection';

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
  const { connections, statuses, setStatus, toast } = useAppStore();
  const status = statuses[hostId];
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
        setError(st.error || '连接失败');
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
            <h3>正在连接 {conn?.name || hostId}…</h3>
            <p>首次打开会自动建立到 Docker 主机的连接</p>
          </>
        ) : (
          <>
            <ServerCrash size={36} strokeWidth={1.2} color="var(--text-muted)" />
            <h3>未连接到 {conn?.name || hostId}</h3>
            <p style={{ maxWidth: 420, lineHeight: 1.6 }}>
              {error
                ? `连接失败：${error}`
                : '该主机尚未建立连接，请点击下方按钮连接后再管理资源。'}
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className="btn primary" onClick={() => void connect()} disabled={connecting}>
                <Plug size={14} /> {connecting ? '连接中…' : '立即连接'}
              </button>
              <button
                className="btn"
                onClick={() => {
                  attempted.current = true;
                  void connect();
                }}
                disabled={connecting}
              >
                <RefreshCw size={14} /> 重试
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
