import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Search, FileText, Info, ArrowUp, ArrowDown, X } from 'lucide-react';
import type { ContainerSummary } from '../../types/docker';
import { useAppStore } from '../../stores/appStore';
import { usePolling } from '../../hooks/usePolling';
import { useHotkeys } from '../../utils/useHotkeys';
import { loadUiPref, saveUiPref } from '../../utils/uiPrefs';
import {
  localizeStatusChip,
  localizeContainerStatus,
  statusChipExtraClass,
} from '../../utils/localize';
import { ListError, ListLoading } from '../common/ListFeedback';
import { SortableTh } from '../common/SortableTh';
import { fmtTimeAgo, fmtAbsolute } from '../../utils/format';
import { t, useT } from '../../i18n';

interface Row {
  hostId: string;
  hostName: string;
  c: ContainerSummary;
}

type SortKey = 'host' | 'name' | 'state' | 'image' | 'project' | 'created';
type StateFilter = 'all' | 'running' | 'exited' | 'paused' | 'restarting';

/**
 * Containers across every connected host in one table. Fetches all hosts in
 * parallel on open/refresh and also seeds the per-host store so the sidebar
 * tree and command palette stay in sync.
 */
export function AggregateContainersPage({ active = true }: { active?: boolean }) {
  const t = useT();
  const toast = useAppStore((s) => s.toast);
  const openTab = useAppStore((s) => s.openTab);
  const setContainers = useAppStore((s) => s.setContainers);
  const setRefreshing = useAppStore((s) => s.setRefreshing);
  const connections = useAppStore((s) => s.connections);
  const statuses = useAppStore((s) => s.statuses);
  const containersVersion = useAppStore((s) => s.containersVersion);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState(() => loadUiPref('aggregate.filter', ''));
  const [stateFilter, setStateFilter] = useState<StateFilter>(() =>
    loadUiPref('aggregate.stateFilter', 'all')
  );
  const [sortKey, setSortKey] = useState<SortKey>(() => loadUiPref('aggregate.sortKey', 'host'));
  const [sortAsc, setSortAsc] = useState(() => loadUiPref('aggregate.sortAsc', true));
  const [selected, setSelected] = useState<string | null>(null);
  const filterRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setRefreshing(true);
    setError(null);
    try {
      const connected = useAppStore
        .getState()
        .connections.filter((c) => useAppStore.getState().statuses[c.id]?.connected);
      const results = await Promise.allSettled(
        connected.map(async (conn) => {
          const list = await window.dockerApi.listContainers(conn.id, true);
          setContainers(conn.id, list);
          return { hostId: conn.id, hostName: conn.name || conn.id, list };
        })
      );
      const out: Row[] = [];
      const failed: string[] = [];
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') {
          for (const c of r.value.list) {
            out.push({ hostId: r.value.hostId, hostName: r.value.hostName, c });
          }
        } else {
          failed.push(connected[i]?.name || connected[i]?.id || '?');
        }
      });
      setRows(out);
      if (failed.length === connected.length && connected.length > 0) {
        setError(t('所有主机的容器列表获取均失败，请检查连接状态'));
      } else if (failed.length > 0) {
        toast(t("部分主机获取失败：{p0}", { p0: failed.join('、') }), 'error');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [setContainers, setRefreshing, toast]);

  // slow fallback poll — docker events drive most reloads; the hook skips
  // ticks while hidden and catches up when the tab becomes visible again
  usePolling({ active, intervalMs: 30000, onLoad: load });

  // remember filter / state filter / sort across sessions
  useEffect(() => {
    saveUiPref('aggregate.filter', filter);
  }, [filter]);
  useEffect(() => {
    saveUiPref('aggregate.stateFilter', stateFilter);
  }, [stateFilter]);
  useEffect(() => {
    saveUiPref('aggregate.sortKey', sortKey);
    saveUiPref('aggregate.sortAsc', sortAsc);
  }, [sortKey, sortAsc]);

  // reload when docker events indicate containers changed
  useEffect(() => {
    if (containersVersion > 0) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containersVersion]);

  useHotkeys({
    f5: () => void load(),
    'mod+f': () => filterRef.current?.focus(),
    escape: () => setSelected(null),
  });

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const base = rows.filter(({ c }) => stateFilter === 'all' || c.state === stateFilter);
    if (!q) return base;
    return base.filter(({ hostName, c }) =>
      `${c.name} ${c.image} ${hostName} ${c.composeProject || ''} ${c.id}`
        .toLowerCase()
        .includes(q)
    );
  }, [rows, filter, stateFilter]);

  const sorted = useMemo(() => {
    const dir = sortAsc ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sortKey) {
        case 'host':
          return dir * a.hostName.localeCompare(b.hostName);
        case 'name':
          return dir * a.c.name.localeCompare(b.c.name);
        case 'state':
          return dir * a.c.state.localeCompare(b.c.state);
        case 'image':
          return dir * a.c.image.localeCompare(b.c.image);
        case 'project':
          return dir * (a.c.composeProject || '').localeCompare(b.c.composeProject || '');
        case 'created':
          return dir * (a.c.created - b.c.created);
        default:
          return 0;
      }
    });
  }, [filtered, sortKey, sortAsc]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else {
      setSortKey(key);
      setSortAsc(key === 'host' || key === 'name' || key === 'image' || key === 'project');
    }
  };

  const sortInd = (key: SortKey) =>
    sortKey === key ? <span className="sort-ind">{sortAsc ? <ArrowUp size={11} /> : <ArrowDown size={11} />}</span> : null;

  const openDetail = (r: Row) => {
    openTab({
      id: `containerDetail:${r.hostId}:${r.c.id}`,
      title: t("容器: {p0}", { p0: r.c.name }),
      kind: 'containerDetail',
      hostId: r.hostId,
      containerId: r.c.id,
    });
  };

  const hostCount = useMemo(
    () => new Set(rows.map((r) => r.hostId)).size,
    [rows]
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div className="content-toolbar">
        <button className="btn" onClick={load} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'spinner' : ''} /> {t('刷新')}
        </button>
        <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
          {hostCount} {t('台主机')} · {filtered.length}/{rows.length} {t('个容器')}
        </span>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value as StateFilter)}
            style={{ height: 28 }}
          >
            <option value="all">{t('全部状态')}</option>
            <option value="running">{t('运行中')}</option>
            <option value="exited">{t('已退出')}</option>
            <option value="paused">{t('已暂停')}</option>
            <option value="restarting">{t('重启中')}</option>
          </select>
          <div style={{ position: 'relative' }}>
            <Search size={13} style={{ position: 'absolute', left: 8, top: 8, color: 'var(--text-muted)' }} />
            <input
              ref={filterRef}
              className="search-input"
              style={{ paddingLeft: 26, paddingRight: filter ? 26 : undefined }}
              placeholder={t('跨主机搜索名称 / 镜像 / 项目（Ctrl+F）')}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            {filter && (
              <button
                className="btn ghost icon-btn"
                style={{ position: 'absolute', right: 2, top: 2, width: 22, height: 22 }}
                title={t('清除过滤')}
                onClick={() => {
                  setFilter('');
                  filterRef.current?.focus();
                }}
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>
      </div>

      {error && <ListError error={error} onRetry={() => void load()} />}

      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {loading && rows.length === 0 && !error ? (
          <ListLoading label={t('正在汇总各主机容器…')} />
        ) : connections.filter((c) => statuses[c.id]?.connected).length === 0 ? (
          <div className="empty-state">
            <p>{t('尚未连接任何 Docker 主机')}</p>
          </div>
        ) : sorted.length === 0 ? (
          <div className="empty-state">
            <p>{rows.length === 0 ? t('没有容器') : t('没有匹配的容器')}</p>
            {rows.length > 0 && (
              <button
                className="btn ghost"
                onClick={() => {
                  setFilter('');
                  setStateFilter('all');
                }}
              >
                <X size={12} /> {t('清除过滤')}
              </button>
            )}
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <SortableTh label={t('主机')} active={sortKey === 'host'} asc={sortAsc} onSort={() => toggleSort('host')} />
                <SortableTh label={t('名称')} active={sortKey === 'name'} asc={sortAsc} onSort={() => toggleSort('name')} />
                <SortableTh label={t('状态')} active={sortKey === 'state'} asc={sortAsc} onSort={() => toggleSort('state')} />
                <SortableTh label={t('镜像')} active={sortKey === 'image'} asc={sortAsc} onSort={() => toggleSort('image')} />
                <SortableTh label={t('项目')} active={sortKey === 'project'} asc={sortAsc} onSort={() => toggleSort('project')} />
                <SortableTh label={t('创建时间')} active={sortKey === 'created'} asc={sortAsc} onSort={() => toggleSort('created')} />
                <th style={{ width: 80 }}>{t('操作')}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr
                  key={`${r.hostId}:${r.c.id}`}
                  title={t('双击打开详情')}
                  className={selected === `${r.hostId}:${r.c.id}` ? 'selected' : ''}
                  onClick={() => setSelected(`${r.hostId}:${r.c.id}`)}
                  onDoubleClick={() => openDetail(r)}
                >
                  <td style={{ color: 'var(--host)' }}>{r.hostName}</td>
                  <td style={{ color: 'var(--text-bright)' }}>{r.c.name}</td>
                  <td>
                    <span className={`chip ${r.c.state} ${statusChipExtraClass(r.c.status, r.c.state)}`}>
                      <span className="dot" />
                      <span title={localizeContainerStatus(r.c.status)}>
                        {localizeStatusChip(r.c.status, r.c.state)}
                      </span>
                    </span>
                  </td>
                  <td
                    className="mono"
                    title={r.c.image}
                    style={{
                      color: 'var(--text-dim)',
                      maxWidth: 240,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {r.c.image}
                  </td>
                  <td style={{ color: 'var(--compose)' }}>{r.c.composeProject || '-'}</td>
                  <td
                    style={{ color: 'var(--text-muted)', fontSize: 11, whiteSpace: 'nowrap' }}
                    title={fmtAbsolute(r.c.created * 1000)}
                  >
                    {fmtTimeAgo(r.c.created * 1000)}
                  </td>
                  <td>
                    <button
                      className="btn ghost icon-btn"
                      title={t('详情')}
                      style={{ width: 24, height: 24 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        openDetail(r);
                      }}
                    >
                      <Info size={12} />
                    </button>
                    <button
                      className="btn ghost icon-btn"
                      title={t('日志')}
                      style={{ width: 24, height: 24 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        openTab({
                          id: `logs:${r.hostId}:${r.c.id}`,
                          title: t("日志 · {p0}", { p0: r.c.name }),
                          kind: 'logs',
                          hostId: r.hostId,
                          containerId: r.c.id,
                        });
                      }}
                    >
                      <FileText size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
