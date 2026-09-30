import { useEffect, useRef, useState } from 'react';
import { RefreshCw, Download, Trash2 } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';

export function LogViewerPage({ hostId, containerId }: { hostId: string; containerId: string }) {
  const { toast } = useAppStore();
  const [lines, setLines] = useState<string[]>([]);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [buffer, setBuffer] = useState<string[]>([]);
  const bodyRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(false);
  const key = `${hostId}:${containerId}`;

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    let unsubData: () => void;
    let unsubErr: () => void;
    let unsubEnd: () => void;

    const start = async () => {
      try {
        await window.dockerApi.openLogs(hostId, containerId, 500);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return;
      }

      unsubData = window.dockerApi.onLogData((p) => {
        if (p.key !== key) return;
        const parts = p.data.split('\n').filter((s) => s.length > 0);
        if (pausedRef.current) {
          setBuffer((b) => [...b.slice(-2000), ...parts]);
        } else {
          setLines((l) => {
            const next = [...l, ...parts];
            return next.length > 5000 ? next.slice(next.length - 5000) : next;
          });
        }
      });
      unsubErr = window.dockerApi.onLogError((p) => {
        if (p.key === key) setError(p.error);
      });
      unsubEnd = window.dockerApi.onLogEnd((p) => {
        if (p.key === key) setError(null);
      });
    };

    void start();

    return () => {
      unsubData?.();
      unsubErr?.();
      unsubEnd?.();
      void window.dockerApi.closeLogs(hostId, containerId);
    };
  }, [hostId, containerId, key]);

  useEffect(() => {
    if (!paused && buffer.length > 0) {
      setLines((l) => {
        const next = [...l, ...buffer];
        return next.length > 5000 ? next.slice(next.length - 5000) : next;
      });
      setBuffer([]);
    }
  }, [paused, buffer]);

  useEffect(() => {
    if (!paused && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [lines, paused]);

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
        <button
          className="btn"
          onClick={() => {
            setLines([]);
            setBuffer([]);
            void window.dockerApi.closeLogs(hostId, containerId);
            void window.dockerApi.openLogs(hostId, containerId, 500);
            toast('已重新加载日志', 'info');
          }}
        >
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
          }}
        >
          <Trash2 size={13} /> 清空
        </button>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {lines.length} 行{buffer.length > 0 ? ` · 暂停中 +${buffer.length}` : ''}
        </span>
      </div>

      {error && (
        <div style={{ padding: 8, background: 'rgba(207,91,86,0.12)', color: 'var(--error)', fontSize: 12 }}>
          {error}
        </div>
      )}

      <div ref={bodyRef} className="log-view" style={{ flex: 1, overflow: 'auto' }}>
        {lines.length === 0 && (
          <div style={{ color: 'var(--text-muted)', padding: 12 }}>等待日志输出…</div>
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
          return <div key={i}>{line}</div>;
        })}
      </div>
    </div>
  );
}
