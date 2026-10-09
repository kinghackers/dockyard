import { useCallback, useEffect, useMemo, useRef, useState, memo, type ReactNode } from 'react';
import { RefreshCw, Download, Trash2, Radio, Search, X } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { useHotkeys } from '../../utils/useHotkeys';
import { detectLogLevel } from '../../utils/logLevel';
import { loadUiPref } from '../../utils/uiPrefs';
import { t, useT } from '../../i18n';

/** rolling buffer cap — read live so settings.logMaxLines changes apply without restart */
const logCap = () => loadUiPref('settings.logMaxLines', 8000);
const TAIL_LINES = 500;

/**
 * Memoized log line: unchanged lines (string identity) skip re-render when
 * new chunks append or the filter box toggles, which keeps 5000-line views
 * cheap to update.
 */
const LogLine = memo(function LogLine({ line, q }: { line: string; q: string }) {
  const m = line.match(/^(\S+Z)\s(.*)$/);
  const text = m ? m[2] : line;
  const ts = m ? m[1].slice(0, 19) : null;

  let body: ReactNode = text || ' ';
  if (q) {
    const lower = text.toLowerCase();
    const needle = q.toLowerCase();
    const parts: ReactNode[] = [];
    let from = 0;
    let hit = lower.indexOf(needle, from);
    let key = 0;
    while (hit >= 0) {
      if (hit > from) parts.push(text.slice(from, hit));
      parts.push(
        <mark key={key++} className="log-hl">
          {text.slice(hit, hit + q.length)}
        </mark>
      );
      from = hit + q.length;
      hit = lower.indexOf(needle, from);
    }
    if (from < text.length) parts.push(text.slice(from));
    body = parts;
  }

  return (
    <div className={detectLogLevel(line) ? `log-line log-line-${detectLogLevel(line)}` : undefined}>
      {ts && <span className="log-line-ts">{ts} </span>}
      {body}
    </div>
  );
});

export function LogViewerPage({ hostId, containerId }: { hostId: string; containerId: string }) {
  const t = useT();
  const toast = useAppStore((s) => s.toast);
  const [lines, setLines] = useState<string[]>([]);
  const [paused, setPaused] = useState(false);
  const [status, setStatus] = useState<'connecting' | 'live' | 'ended' | 'error'>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [buffer, setBuffer] = useState<string[]>([]);
  const [logFilter, setLogFilter] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
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
        return next.length > logCap() ? next.slice(next.length - logCap()) : next;
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
        return next.length > logCap() ? next.slice(next.length - logCap()) : next;
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
    toast(t('已重新加载日志'), 'info');
  };

  const exportLog = () => {
    // export what the current filter shows, not the whole buffer
    const blob = new Blob([visibleLines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${containerId.slice(0, 12)}.log`;
    a.click();
    URL.revokeObjectURL(url);
    toast(
      logFilter.trim()
        ? t("已按当前过滤导出 {p0}/{p1} 行", { p0: visibleLines.length, p1: lines.length })
        : t("已导出 {p0} 行日志", { p0: lines.length }),
      'success'
    );
  };

  const visibleLines = useMemo(() => {
    const q = logFilter.trim();
    if (!q) return lines;
    // /pattern/ filters by regex, anything else by substring
    if (q.length > 2 && q.startsWith('/') && q.endsWith('/')) {
      try {
        const re = new RegExp(q.slice(1, -1), 'i');
        return lines.filter((l) => re.test(l));
      } catch {
        // invalid regex — fall through to substring
      }
    }
    const lower = q.toLowerCase();
    return lines.filter((l) => l.toLowerCase().includes(lower));
  }, [lines, logFilter]);

  const matchCount = logFilter.trim() ? visibleLines.length : lines.length;

  useHotkeys({
    'mod+f': () => filterRef.current?.focus(),
    escape: () => {
      if (logFilter) {
        setLogFilter('');
        return;
      }
    },
  });

  const highlightQuery = logFilter.trim();

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
            setBuffer([]);
            partialRef.current = '';
          }}
        >
          <Trash2 size={13} /> {t('清空')}
        </button>
        <div style={{ position: 'relative', marginLeft: 8 }}>
          <Search size={13} style={{ position: 'absolute', left: 8, top: 8, color: 'var(--text-muted)' }} />
          <input
            ref={filterRef}
            className="search-input"
            style={{ paddingLeft: 26, width: 180 }}
            placeholder={t('过滤日志，支持 /正则/（Ctrl+F）')}
            value={logFilter}
            onChange={(e) => setLogFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setLogFilter('');
                filterRef.current?.blur();
              }
            }}
          />
          {logFilter && (
            <button
              className="btn ghost icon-btn"
              style={{ position: 'absolute', right: 2, top: 2, width: 22, height: 22 }}
              title={t('清除过滤')}
              onClick={() => {
                setLogFilter('');
                filterRef.current?.focus();
              }}
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
              status === 'live'
                ? 'var(--success)'
                : status === 'error'
                  ? 'var(--error)'
                  : 'var(--text-muted)',
          }}
        >
          <Radio size={12} />
          {status === 'connecting' && t('连接中…')}
          {status === 'live' && (paused ? t('已暂停滚动 · 仍在接收') : t('实时跟随中'))}
          {status === 'ended' && t('流已结束，正在重连…')}
          {status === 'error' && t('错误: {p0}', { p0: error || t('未知') })}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>
          {logFilter.trim()
            ? t("{p0}/{p1} 行匹配", { p0: matchCount, p1: lines.length })
            : t("{p0} 行", { p0: lines.length })}
          {buffer.length > 0 ? t(" · 暂停中 +{p0}", { p0: buffer.length }) : ''}
        </span>
      </div>

      {error && status === 'error' && (
        <div className="alert danger" style={{ borderRadius: 0 }}>
          {error}
        </div>
      )}

      <div ref={bodyRef} className="log-view" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {lines.length === 0 && (
          <div style={{ color: 'var(--text-muted)', padding: 12 }}>
            {status === 'connecting' ? t('正在获取日志…') : t('等待日志输出…')}
          </div>
        )}
        {lines.length > 0 && visibleLines.length === 0 && (
          <div style={{ color: 'var(--text-muted)', padding: 12 }}>{t('没有匹配的日志行')}</div>
        )}
        {visibleLines.map((line, i) => (
          <LogLine key={i} line={line} q={highlightQuery} />
        ))}
      </div>
    </div>
  );
}
