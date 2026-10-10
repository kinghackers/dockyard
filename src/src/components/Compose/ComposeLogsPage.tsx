import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import { RefreshCw, Download, Trash2, Radio, Search, X } from 'lucide-react';
import type { ContainerSummary } from '../../types/docker';
import { useAppStore } from '../../stores/appStore';
import { reportError } from '../../utils/connection';
import { useHotkeys } from '../../utils/useHotkeys';
import { loadUiPref } from '../../utils/uiPrefs';
import { detectLogLevel } from '../../utils/logLevel';
import { t, useT } from '../../i18n';

/** rolling buffer cap — read live so settings.logMaxLines changes apply without restart */
const logCap = () => loadUiPref('settings.logMaxLines', 8000);
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
  const lvl = detectLogLevel(text);
  return (
    <div className={lvl ? `log-line log-line-${lvl}` : undefined}>
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
export function ComposeLogsPage({
  hostId,
  projectName,
  active = true,
}: {
  hostId: string;
  projectName: string;
  active?: boolean;
}) {
  const t = useT();
  const toast = useAppStore((s) => s.toast);
  const containersVersion = useAppStore((s) => s.containersVersion);
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
  /** container ids this page currently streams (survives membership refreshes) */
  const openedRef = useRef<Set<string>>(new Set());
  /** last membership fingerprint — skips no-op refreshes */
  const membersKeyRef = useRef('');

  useEffect(() => {
    pausedRef.current = paused;
    if (!paused && pausedBufferRef.current.length > 0) {
      const buf = pausedBufferRef.current;
      pausedBufferRef.current = [];
      setLines((l) => {
        const next = [...l, ...buf];
        return next.length > logCap() ? next.slice(next.length - logCap()) : next;
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
        return next.length > logCap() ? next.slice(next.length - logCap()) : next;
      });
    }
  }, []);

  // load project members; docker events refresh membership because service
  // restarts get NEW container ids that must be followed too
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const all = await window.dockerApi.listContainers(hostId, true);
        const members = all.filter((c) => c.composeProject === projectName);
        if (cancelled) return;
        // skip no-op refreshes so the stream effect below does not churn
        const key = members.map((c) => `${c.id}:${serviceOf(c)}`).sort().join('|');
        if (key === membersKeyRef.current) return;
        membersKeyRef.current = key;
        setContainers(members);
        setStatus('connecting');
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
  }, [hostId, projectName, containersVersion]);

  // follow one log stream per member container. Membership changes apply
  // incrementally — a full teardown would lose line continuity and re-tail
  // duplicates on every refresh
  useEffect(() => {
    if (containers.length === 0) return;
    let disposed = false;
    const unsubs: Array<() => void> = [];
    const retryTimers: ReturnType<typeof setTimeout>[] = [];

    const nameById = new Map(containers.map((c) => [c.id, serviceOf(c)]));
    const wanted = new Set(containers.map((c) => c.id));
    const keyOf = (k: string) => (k.startsWith(`${hostId}:`) ? k.slice(hostId.length + 1) : k);

    unsubs.push(
      window.dockerApi.onLogData((p) => {
        const cid = keyOf(p.key);
        const service = nameById.get(cid);
        // only this project's streams — single-container viewers on the same
        // host share the channel and would otherwise leak lines in here
        if (!service) return;
        const raw = (partialsRef.current[cid] || '') + p.data;
        const parts = raw.split('\n');
        partialsRef.current[cid] = parts.pop() ?? '';
        for (const t of parts) pushLine(service, t);
      })
    );
    unsubs.push(
      window.dockerApi.onLogError((p) => {
        if (!nameById.get(keyOf(p.key))) return;
        setError(p.error);
      })
    );
    unsubs.push(
      window.dockerApi.onLogEnd((p) => {
        const cid = keyOf(p.key);
        if (!nameById.get(cid)) return;
        // docker ends tail streams when containers stop — re-follow shortly
        // (same recovery LogViewerPage uses for single-container tabs)
        openedRef.current.delete(cid);
        retryTimers.push(
          setTimeout(() => {
            if (disposed || openedRef.current.has(cid)) return;
            openedRef.current.add(cid);
            void window.dockerApi.openLogs(hostId, cid, TAIL_LINES).catch((e) => {
              openedRef.current.delete(cid);
              console.error('openLogs', cid, e);
            });
          }, 2000)
        );
      })
    );

    void (async () => {
      // stop following containers that left the project (e.g. replaced by a restart)
      for (const id of [...openedRef.current]) {
        if (!wanted.has(id)) {
          openedRef.current.delete(id);
          delete partialsRef.current[id];
          void window.dockerApi.closeLogs(hostId, id);
        }
      }
      // follow containers we are not yet streaming
      for (const c of containers) {
        if (disposed || openedRef.current.has(c.id)) continue;
        openedRef.current.add(c.id);
        try {
          await window.dockerApi.openLogs(hostId, c.id, TAIL_LINES);
        } catch (e) {
          openedRef.current.delete(c.id);
          // one bad container should not kill the whole aggregate
          console.error('openLogs', c.id, e);
        }
      }
      if (!disposed) setStatus('live');
    })();

    return () => {
      disposed = true;
      for (const t of retryTimers) clearTimeout(t);
      for (const u of unsubs) u();
    };
  }, [hostId, containers, pushLine]);

  // leaving the view entirely: stop every stream this page opened
  useEffect(() => {
    return () => {
      for (const id of openedRef.current) {
        void window.dockerApi.closeLogs(hostId, id);
      }
      openedRef.current.clear();
      partialsRef.current = {};
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostId, projectName]);

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
    const raw = filter.trim();
    // /pattern/ filters by regex over the line text, anything else by substring
    let re: RegExp | null = null;
    if (raw.length > 2 && raw.startsWith('/') && raw.endsWith('/')) {
      try {
        re = new RegExp(raw.slice(1, -1), 'i');
      } catch {
        re = null;
      }
    }
    const q = raw.toLowerCase();
    return lines.filter((l) => {
      if (serviceFilter && l.service !== serviceFilter) return false;
      if (!raw) return true;
      if (re) return re.test(l.text) || re.test(l.service);
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
        toast(t('已重新连接项目日志'), 'info');
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
    toast(t("已导出 {p0} 行日志", { p0: visible.length }), 'success');
  };

  useHotkeys({
    'mod+f': () => filterRef.current?.focus(),
    escape: () => {
      if (filter) setFilter('');
    },
  }, active);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, overflow: 'hidden' }}>
      <div className="content-toolbar">
        <button className="btn" onClick={handleReload}>
          <RefreshCw size={14} /> {t('重新加载')}
        </button>
        <button className={`btn ${paused ? 'primary' : ''}`} onClick={() => setPaused(!paused)}>
          {paused ? t('恢复滚动') : t('暂停')}
        </button>
        <button className="btn" onClick={exportLog}>
          <Download size={13} /> {t('导出')}
        </button>
        <button
          className="btn"
          onClick={() => {
            setLines([]);
            pausedBufferRef.current = [];
          }}
        >
          <Trash2 size={13} /> {t('清空')}
        </button>

        <select
          value={serviceFilter}
          onChange={(e) => setServiceFilter(e.target.value)}
          style={{ height: 28, marginLeft: 8 }}
        >
          <option value="">{t('全部服务')}</option>
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
            placeholder={t('过滤日志，支持 /正则/（Ctrl+F）')}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          {filter && (
            <button
              className="btn ghost icon-btn"
              style={{ position: 'absolute', right: 2, top: 2, width: 22, height: 22 }}
              title={t('清除过滤')}
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
          {status === 'connecting' && t('连接中…')}
          {status === 'live' && (paused ? t('已暂停滚动 · 仍在接收') : t("{p0} 个服务实时跟随", { p0: containers.length }))}
          {status === 'error' && t('错误: {p0}', { p0: error || t('未知') })}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>
          {filter.trim() || serviceFilter ? t("{p0}/{p1} 行", { p0: visible.length, p1: lines.length }) : t("{p0} 行", { p0: lines.length })}
        </span>
      </div>

      {error && (
        <div className="alert danger" style={{ borderRadius: 0 }}>
          {error}
        </div>
      )}

      <div ref={bodyRef} className="log-view" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {lines.length === 0 && (
          <div style={{ color: 'var(--text-muted)', padding: 12 }}>
            {status === 'connecting' ? t('正在获取各服务日志…') : t('等待日志输出…')}
          </div>
        )}
        {lines.length > 0 && visible.length === 0 && (
          <div style={{ color: 'var(--text-muted)', padding: 12 }}>{t('没有匹配的日志行')}</div>
        )}
        {visible.map((l) => (
          <ComposeLogLine key={l.id} service={l.service} ts={l.ts} text={l.text} />
        ))}
      </div>
    </div>
  );
}
