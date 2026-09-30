import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, Download, Trash2, Radio } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';

const MAX_LINES = 5000;
const TAIL_LINES = 500;

export function LogViewerPage({ hostId, containerId }: { hostId: string; containerId: string }) {
  const { toast } = useAppStore();
  const [lines, setLines] = useState<string[]>([]);
  const [paused, setPaused] = useState(false);
  const [status, setStatus] = useState<'connecting' | 'live' | 'ended' | 'error'>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [buffer, setBuffer] = useState<string[]>([]);
  const bodyRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(false);
  const key = `${hostId}:${containerId}`;
  /** incomplete trailing line, kept across chunks */
  const partialRef = useRef('');
  /** bump to force a reconnect */
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  const pushLines = useCallback((parts: string[]) => {
    if (parts.length === 0) return;
    if (pausedRef.current) {
      setBuffer((b) => [...b.slice(-2000), ...parts]);
    } else {
      setLines((l) => {
        const next = [...l, ...parts];
        return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
      });
    }
  }, []);

  // Main streaming lifecycle. Listeners MUST be attached before openLogs,
  // otherwise the initial tail is sent over IPC and dropped.
  useEffect(() => {
    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    const unsubs: Array<() => void> = [];

    const start = async () => {
      if (disposed) return;
      setStatus('connecting');
      setError(null);
      partialRef.current = '';

      // 1) attach listeners first
      unsubs.push(
        window.dockerApi.onLogData((p) => {
          if (p.key !== key) return;
          const raw = partialRef.current + p.data;
          const parts = raw.split('\n');
          // last element is either '' (line ended) or an incomplete tail
          partialRef.current = parts.pop() ?? '';
          // keep empty lines: they are valid log output
          pushLines(parts);
        })
      );
      unsubs.push(
        window.dockerApi.onLogError((p) => {
          if (p.key !== key) return;
          setError(p.error);
          setStatus('error');
        })
      );
      unsubs.push(
        window.dockerApi.onLogEnd((p) => {
          if (p.key !== key || disposed) return;
          // flush any partial line
          if (partialRef.current) {
            pushLines([partialRef.current]);
            partialRef.current = '';
          }
          setStatus('ended');
          // auto-reconnect so the view keeps following the container
          reconnectTimer = setTimeout(() => {
            if (disposed) return;
            setReloadToken((t) => t + 1);
          }, 2000);
        })
      );

      // 2) then open the stream (now we cannot miss the tail)
      try {
        await window.dockerApi.openLogs(hostId, containerId, TAIL_LINES);
        if (disposed) {
          void window.dockerApi.closeLogs(hostId, containerId);
          return;
        }
        setStatus('live');
      } catch (e) {
        if (disposed) return;
        setError(e instanceof Error ? e.message : String(e));
        setStatus('error');
        // one retry after a short delay (host may be reconnecting)
        reconnectTimer = setTimeout(() => {
          if (disposed) return;
          setReloadToken((t) => t + 1);
        }, 3000);
      }
    };

    void start();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      for (const u of unsubs) u();
      void window.dockerApi.closeLogs(hostId, containerId);
    };
  }, [hostId, containerId, key, reloadToken, pushLines]);

  useEffect(() => {
    if (!paused && buffer.length > 0) {
      setLines((l) => {
        const next = [...l, ...buffer];
        return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
      });
      setBuffer([]);
    }
  }, [paused, buffer]);

  useEffect(() => {
    if (!paused && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [lines, paused]);

  const handleReload = () => {
    setLines([]);
    setBuffer([]);
    partialRef.current = '';
    setReloadToken((t) => t + 1);
    toast('已重新加载日志', 'info');
  };

  const exportLog = () => {
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${containerId.slice(0, 12)}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="content-toolbar">
        <button className="btn" onClick={handleReload}>
          <RefreshCw size={14} /> 重新加载
        </button>
        <button className={`btn ${paused ? 'primary' : ''}`} onClick={() => setPaused(!paused)}>
          {paused ? '恢复滚动' : '暂停'}
        </button>
        <button className="btn" onClick={exportLog}>
          <Download size={13} /> 导出
        </button>
        <button
          className="btn"
          onClick={() => {
            setLines([]);
            setBuffer([]);
            partialRef.current = '';
          }}
        >
          <Trash2 size={13} /> 清空
        </button>
        <div style={{ flex: 1 }} />
        <span
          style={{
            fontSize: 11,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            color:
              status === 'live'
                ? 'var(--success)'
                : status === 'error'
                  ? 'var(--error)'
                  : 'var(--text-muted)',
          }}
        >
          <Radio size={12} />
          {status === 'connecting' && '连接中…'}
          {status === 'live' && (paused ? '已暂停滚动 · 仍在接收' : '实时跟随中')}
          {status === 'ended' && '流已结束，正在重连…'}
          {status === 'error' && `错误: ${error || '未知'}`}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>
          {lines.length} 行{buffer.length > 0 ? ` · 暂停中 +${buffer.length}` : ''}
        </span>
      </div>

      {error && status === 'error' && (
        <div style={{ padding: 8, background: 'rgba(207,91,86,0.12)', color: 'var(--error)', fontSize: 12 }}>
          {error}
        </div>
      )}

      <div ref={bodyRef} className="log-view" style={{ flex: 1, overflow: 'auto' }}>
        {lines.length === 0 && (
          <div style={{ color: 'var(--text-muted)', padding: 12 }}>
            {status === 'connecting' ? '正在获取日志…' : '等待日志输出…'}
          </div>
        )}
        {lines.map((line, i) => {
          // docker --timestamps format: 2024-01-01T00:00:00.000000000Z message
          const m = line.match(/^(\S+Z)\s(.*)$/);
          if (m) {
            return (
              <div key={i}>
                <span className="log-line-ts">{m[1].slice(0, 19)} </span>
                {m[2]}
              </div>
            );
          }
          return <div key={i}>{line || ' '}</div>;
        })}
      </div>
    </div>
  );
}
