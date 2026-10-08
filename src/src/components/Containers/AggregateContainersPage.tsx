import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Search, FileText, Info } from 'lucide-react';
import type { ContainerSummary } from '../../types/docker';
import { useAppStore } from '../../stores/appStore';
import { useHotkeys } from '../../utils/useHotkeys';
import {
  localizeStatusChip,
  localizeContainerStatus,
  statusChipExtraClass,
} from '../../utils/localize';
import { ListError, ListLoading } from '../common/ListFeedback';

interface Row {
  hostId: string;
  hostName: string;
  c: ContainerSummary;
}

/**
 * Containers across every connected host in one table. Fetches all hosts in
 * parallel on open/refresh and also seeds the per-host store so the sidebar
 * tree and command palette stay in sync.
 */
export function AggregateContainersPage() {
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
  const [filter, setFilter] = useState('');
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
        setError('所有主机的容器列表获取均失败，请检查连接状态');
      } else if (failed.length > 0) {
        toast(`部分主机获取失败：${failed.join('、')}`, 'error');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [setContainers, setRefreshing, toast]);

  useEffect(() => {
    void load();
  }, [load]);

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
    if (!q) return rows;
    return rows.filter(({ hostName, c }) =>
      `${c.name} ${c.image} ${hostName} ${c.composeProject || ''} ${c.id}`
        .toLowerCase()
        .includes(q)
    );
  }, [rows, filter]);

  const openDetail = (r: Row) => {
    openTab({
      id: `containerDetail:${r.hostId}:${r.c.id}`,
      title: `容器: ${r.c.name}`,
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
          <RefreshCw size={14} className={loading ? 'spinner' : ''} /> 刷新
        </button>
        <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
          {hostCount} 台主机 · {filtered.length}/{rows.length} 个容器
        </span>
        <div style={{ flex: 1 }} />
        <div style={{ position: 'relative' }}>
          <Search size={13} style={{ position: 'absolute', left: 8, top: 8, color: 'var(--text-muted)' }} />
          <input
            ref={filterRef}
            className="search-input"
            style={{ paddingLeft: 26 }}
            placeholder="跨主机搜索名称 / 镜像 / 项目（Ctrl+F）"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      </div>

      {error && <ListError error={error} onRetry={() => void load()} />}

      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {loading && rows.length === 0 && !error ? (
          <ListLoading label="正在汇总各主机容器…" />
        ) : connections.filter((c) => statuses[c.id]?.connected).length === 0 ? (
          <div className="empty-state">
            <p>尚未连接任何 Docker 主机</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <p>{rows.length === 0 ? '没有容器' : '没有匹配的容器'}</p>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th className="sortable">主机</th>
                <th>名称</th>
                <th>状态</th>
                <th>镜像</th>
                <th>项目</th>
                <th>创建时间</th>
                <th style={{ width: 80 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr
                  key={`${r.hostId}:${r.c.id}`}
                  title="双击打开详情"
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
                  <td style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                    {new Date(r.c.created * 1000).toLocaleString()}
                  </td>
                  <td>
                    <button
                      className="btn ghost icon-btn"
                      title="详情"
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
                      title="日志"
                      style={{ width: 24, height: 24 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        openTab({
                          id: `logs:${r.hostId}:${r.c.id}`,
                          title: `日志 · ${r.c.name}`,
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
