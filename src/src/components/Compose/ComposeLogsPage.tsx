import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import { RefreshCw, Download, Trash2, Radio, Search, X } from 'lucide-react';
import type { ContainerSummary } from '../../types/docker';
import { useAppStore } from '../../stores/appStore';
import { reportError } from '../../utils/connection';
import { useHotkeys } from '../../utils/useHotkeys';

const MAX_LINES = 8000;
const TAIL_LINES = 200;

type Line = {
  id: number;
  service: string;
  text: string;
  ts?: string;
};

function serviceOf(c: ContainerSummary): string {
  return c.composeService || c.name;
}

/** Memoized: appending new lines / typing filters skips re-rendering old rows. */
const ComposeLogLine = memo(function ComposeLogLine({
  service,
  ts,
  text,
}: {
  service: string;
  ts?: string;
  text: string;
}) {
  return (
    <div>
      <span className="log-svc">[{service}]</span>
      {ts && <span className="log-line-ts"> {ts} </span>}
      <span> {text || ' '}</span>
    </div>
  );
});

/**
 * Aggregated compose-project logs: streams every service container into one
 * view with a [service] prefix, filterable by service name.
 */
export function ComposeLogsPage({ hostId, projectName }: { hostId: string; projectName: string }) {
  const toast = useAppStore((s) => s.toast);
  const [containers, setContainers] = useState<ContainerSummary[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState('');
  const [serviceFilter, setServiceFilter] = useState('');
  const [status, setStatus] = useState<'connecting' | 'live' | 'ended' | 'error'>('connecting');
  const [error, setError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const pausedRef = useRef(false);
  const lineIdRef = useRef(0);
  const partialsRef = useRef<Record<string, string>>({});
  const pausedBufferRef = useRef<Line[]>([]);

  useEffect(() => {
    pausedRef.current = paused;
    if (!paused && pausedBufferRef.current.length > 0) {
      const buf = pausedBufferRef.current;
      pausedBufferRef.current = [];
      setLines((l) => {
        const next = [...l, ...buf];
        return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
      });
    }
  }, [paused]);

  const pushLine = useCallback((service: string, text: string) => {
    const m = text.match(/^(\S+Z)\s(.*)$/);
    const line: Line = {
      id: lineIdRef.current++,
      service,
      ts: m ? m[1].slice(0, 19) : undefined,
      text: m ? m[2] : text,
    };
    if (pausedRef.current) {
      pausedBufferRef.current.push(line);
      if (pausedBufferRef.current.length > 3000) {
        pausedBufferRef.current = pausedBufferRef.current.slice(-2000);
      }
    } else {
      setLines((l) => {
        const next = [...l, line];
        return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
      });
    }
  }, []);

  // load project members
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const all = await window.dockerApi.listContainers(hostId, true);
        const members = all.filter((c) => c.composeProject === projectName);
        if (!cancelled) {
          setContainers(members);
          setStatus('connecting');
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setStatus('error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hostId, projectName]);

  // open one log stream per container
  useEffect(() => {
    if (containers.length === 0) return;
    let disposed = false;
    const unsubs: Array<() => void> = [];
    const opened: string[] = [];

    const nameById = new Map(containers.map((c) => [c.id, serviceOf(c)]));

    unsubs.push(
      window.dockerApi.onLogData((p) => {
        const cid = p.key.startsWith(`${hostId}:`) ? p.key.slice(hostId.length + 1) : p.key;
        const service = nameById.get(cid) || cid.slice(0, 12);
        const raw = (partialsRef.current[cid] || '') + p.data;
        const parts = raw.split('\n');
        partialsRef.current[cid] = parts.pop() ?? '';
        for (const t of parts) pushLine(service, t);
      })
    );
    unsubs.push(
      window.dockerApi.onLogError((p) => {
        if (!p.key.startsWith(`${hostId}:`)) return;
        setError(p.error);
      })
    );

    void (async () => {
      for (const c of containers) {
        if (disposed) break;
        try {
          await window.dockerApi.openLogs(hostId, c.id, TAIL_LINES);
          opened.push(c.id);
        } catch (e) {
          // one bad container should not kill the whole aggregate
          console.error('openLogs', c.id, e);
        }
      }
      if (!disposed) setStatus('live');
    })();

    return () => {
      disposed = true;
      for (const u of unsubs) u();
      for (const id of opened) {
        void window.dockerApi.closeLogs(hostId, id);
      }
    };
  }, [hostId, containers, pushLine]);

  useEffect(() => {
    if (!paused && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [lines, paused]);

  const services = useMemo(
    () => [...new Set(containers.map(serviceOf))].sort(),
    [containers]
  );

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return lines.filter((l) => {
      if (serviceFilter && l.service !== serviceFilter) return false;
      if (!q) return true;
      return l.text.toLowerCase().includes(q) || l.service.toLowerCase().includes(q);
    });
  }, [lines, filter, serviceFilter]);

  const handleReload = () => {
    setLines([]);
    pausedBufferRef.current = [];
    partialsRef.current = {};
    setContainers([]);
    setStatus('connecting');
    // re-trigger the loader effect
    void (async () => {
      try {
        const all = await window.dockerApi.listContainers(hostId, true);
        const members = all.filter((c) => c.composeProject === projectName);
        setContainers([...members]);
        toast('已重新连接项目日志', 'info');
      } catch (e) {
        reportError(e, toast);
      }
    })();
  };

  const exportLog = () => {
    const blob = new Blob([visible.map((l) => `[${l.service}] ${l.text}`).join('\n')], {
      type: 'text/plain',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${projectName}.log`;
    a.click();
    URL.revokeObjectURL(url);
    toast(`已导出 ${visible.length} 行日志`, 'success');
  };

  useHotkeys({
    'mod+f': () => filterRef.current?.focus(),
    escape: () => {
      if (filter) setFilter('');
    },
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, overflow: 'hidden' }}>
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
            pausedBufferRef.current = [];
          }}
        >
          <Trash2 size={13} /> 清空
        </button>

        <select
          value={serviceFilter}
          onChange={(e) => setServiceFilter(e.target.value)}
          style={{ height: 28, marginLeft: 8 }}
        >
          <option value="">全部服务</option>
          {services.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <div style={{ position: 'relative' }}>
          <Search size={13} style={{ position: 'absolute', left: 8, top: 8, color: 'var(--text-muted)' }} />
          <input
            ref={filterRef}
            className="search-input"
            style={{ paddingLeft: 26, width: 180 }}
            placeholder="过滤日志（Ctrl+F）"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          {filter && (
            <button
              className="btn ghost icon-btn"
              style={{ position: 'absolute', right: 2, top: 2, width: 22, height: 22 }}
              title="清除过滤"
              onClick={() => setFilter('')}
            >
              <X size={12} />
            </button>
          )}
        </div>

        <div style={{ flex: 1 }} />
        <span
          style={{
            fontSize: 11,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            color:
              status === 'live' ? 'var(--success)' : status === 'error' ? 'var(--error)' : 'var(--text-muted)',
          }}
        >
          <Radio size={12} />
          {status === 'connecting' && '连接中…'}
          {status === 'live' && (paused ? '已暂停滚动 · 仍在接收' : `${containers.length} 个服务实时跟随`)}
          {status === 'error' && `错误: ${error || '未知'}`}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>
          {filter.trim() || serviceFilter ? `${visible.length}/${lines.length} 行` : `${lines.length} 行`}
        </span>
      </div>

      {error && (
        <div style={{ padding: 8, background: 'rgba(207,91,86,0.12)', color: 'var(--error)', fontSize: 12 }}>
          {error}
        </div>
      )}

      <div ref={bodyRef} className="log-view" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {lines.length === 0 && (
          <div style={{ color: 'var(--text-muted)', padding: 12 }}>
            {status === 'connecting' ? '正在获取各服务日志…' : '等待日志输出…'}
          </div>
        )}
        {lines.length > 0 && visible.length === 0 && (
          <div style={{ color: 'var(--text-muted)', padding: 12 }}>没有匹配的日志行</div>
        )}
        {visible.map((l) => (
          <ComposeLogLine key={l.id} service={l.service} ts={l.ts} text={l.text} />
        ))}
      </div>
    </div>
  );
}
