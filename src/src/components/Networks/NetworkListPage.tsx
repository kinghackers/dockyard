import { Fragment, useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { RefreshCw, Trash2, Search, Plus, ArrowUp, ArrowDown, Copy } from 'lucide-react';
import type { NetworkSummary } from '../../types/docker';
import { useAppStore } from '../../stores/appStore';
import { reportError } from '../../utils/connection';
import { useConfirm } from '../../utils/useConfirm';
import { useHotkeys } from '../../utils/useHotkeys';
import { loadUiPref, saveUiPref } from '../../utils/uiPrefs';
import { localizeNetworkDriver, localizeScope } from '../../utils/localize';
import { CreateNetworkDialog } from './CreateNetworkDialog';
import { ContextMenu, useContextMenu, type ContextMenuItem } from '../common/ContextMenu';
import { ListError, ListLoading } from '../common/ListFeedback';
import { SortableTh } from '../common/SortableTh';
import { t, useT } from '../../i18n';

type SortKey = 'name' | 'id' | 'driver' | 'scope' | 'subnet';

export function NetworkListPage({ hostId }: { hostId: string }) {
  const t = useT();
  const toast = useAppStore((s) => s.toast);
  const setRefreshing = useAppStore((s) => s.setRefreshing);
  const containersVersion = useAppStore((s) => s.containersVersion);
  const [list, setList] = useState<NetworkSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState(() => loadUiPref('networks.filter', ''));
  const [selected, setSelected] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>(() => loadUiPref('networks.sortKey', 'name'));
  const [sortAsc, setSortAsc] = useState(() => loadUiPref('networks.sortAsc', true));
  const [expanded, setExpanded] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDialog, confirm] = useConfirm();
  const filterRef = useRef<HTMLInputElement>(null);
  const ctx = useContextMenu();

  const load = useCallback(async () => {
    setLoading(true);
    setRefreshing(true);
    setError(null);
    try {
      const data = await window.dockerApi.listNetworks(hostId);
      setList(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [hostId, setRefreshing]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    saveUiPref('networks.filter', filter);
  }, [filter]);
  useEffect(() => {
    saveUiPref('networks.sortKey', sortKey);
    saveUiPref('networks.sortAsc', sortAsc);
  }, [sortKey, sortAsc]);

  useEffect(() => {
    if (containersVersion > 0) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containersVersion]);

  const filtered = useMemo(() => {
    const rows = list.filter((n) => {
      if (!filter) return true;
      const q = filter.toLowerCase();
      return (
        n.name.toLowerCase().includes(q) ||
        n.id.toLowerCase().includes(q) ||
        n.driver.toLowerCase().includes(q)
      );
    });
    const dir = sortAsc ? 1 : -1;
    return [...rows].sort((a, b) => {
      switch (sortKey) {
        case 'name':
          return dir * a.name.localeCompare(b.name);
        case 'id':
          return dir * a.id.localeCompare(b.id);
        case 'driver':
          return dir * a.driver.localeCompare(b.driver);
        case 'scope':
          return dir * a.scope.localeCompare(b.scope);
        case 'subnet':
          return dir * (a.subnet || '').localeCompare(b.subnet || '');
        default:
          return 0;
      }
    });
  }, [list, filter, sortKey, sortAsc]);

  const allChecked = filtered.length > 0 && filtered.every((n) => checked.has(n.id));

  const toggleChecked = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  const removeOne = async (id: string, name: string) => {
    const ok = await confirm({
      title: t('删除网络'),
      message: t("确认删除网络「{p0}」？已连接的容器将被断开。", { p0: name }),
      confirmLabel: t('删除'),
      danger: true,
    });
    if (!ok) return;
    try {
      await window.dockerApi.removeNetwork(hostId, id);
      toast(t('网络已删除'), 'success');
      setSelected(null);
      setChecked((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      await load();
    } catch (e) {
      reportError(e, toast);
    }
  };

  const removeMany = async (ids: string[]) => {
    const ok = await confirm({
      title: t('批量删除网络'),
      message: t("确认删除选中的 {p0} 个网络？已连接的容器将被断开。", { p0: ids.length }),
      confirmLabel: t('删除'),
      danger: true,
    });
    if (!ok) return;
    let okCount = 0;
    for (const id of ids) {
      try {
        await window.dockerApi.removeNetwork(hostId, id);
        okCount++;
      } catch {
        /* keep going */
      }
    }
    toast(t("已删除 {p0}/{p1} 个网络", { p0: okCount, p1: ids.length }), okCount === ids.length ? 'success' : 'error');
    setChecked(new Set());
    setSelected(null);
    await load();
  };

  useHotkeys({
    'mod+f': () => filterRef.current?.focus(),
    f5: () => void load(),
    'mod+a': () => {
      if (filtered.length === 0) return;
      setChecked(new Set(filtered.map((n) => n.id)));
    },
    escape: () => setChecked(new Set()),
    arrowdown: () => {
      if (filtered.length === 0) return;
      const idx = selected ? filtered.findIndex((n) => n.id === selected) : -1;
      const next = filtered[Math.min(idx + 1, filtered.length - 1)] ?? filtered[0];
      setSelected(next.id);
    },
    arrowup: () => {
      if (filtered.length === 0) return;
      const idx = selected ? filtered.findIndex((n) => n.id === selected) : filtered.length;
      const next = filtered[Math.max(idx - 1, 0)] ?? filtered[0];
      setSelected(next.id);
    },
    enter: () => {
      if (!selected) return;
      setExpanded(expanded === selected ? null : selected);
    },
    delete: () => {
      const ids = checked.size > 0 ? [...checked] : selected ? [selected] : [];
      if (ids.length === 0) return;
      const first = list.find((n) => n.id === ids[0]);
      void (ids.length === 1 && first ? removeOne(ids[0], first.name) : removeMany(ids));
    },
  });

  const rowMenu = (n: NetworkSummary): ContextMenuItem[] => {
    const ids = checked.has(n.id) && checked.size > 1 ? [...checked] : [n.id];
    const multi = ids.length > 1;
    return [
      {
        key: 'expand',
        label: expanded === n.id ? t('收起容器列表') : t('查看连接的容器'),
        disabled: multi,
        onSelect: () => setExpanded(expanded === n.id ? null : n.id),
      },
      {
        key: 'copy',
        label: t('复制网络 ID'),
        icon: <Copy size={13} />,
        disabled: multi,
        onSelect: () => {
          void navigator.clipboard?.writeText(n.id);
          toast(t('已复制网络 ID'), 'info');
        },
      },
      { key: 'sep', label: '', separator: true, onSelect: () => {} },
      {
        key: 'del',
        label: multi ? t("删除 {p0} 个…", { p0: ids.length }) : t('删除…'),
        icon: <Trash2 size={13} />,
        danger: true,
        onSelect: () => void (multi ? removeMany(ids) : removeOne(n.id, n.name)),
      },
    ];
  };

  const sortInd = (key: SortKey) =>
    sortKey === key ? (
      <span className="sort-ind">{sortAsc ? <ArrowUp size={11} /> : <ArrowDown size={11} />}</span>
    ) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div className="content-toolbar">
        <button className="btn primary" onClick={() => setCreateOpen(true)}>
          <Plus size={13} /> {t('创建网络')}
        </button>
        <button className="btn" onClick={load} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'spinner' : ''} /> {t('刷新')}
        </button>
        <button
          className="btn danger"
          disabled={!selected}
          onClick={() => {
            if (!selected) return;
            const n = list.find((x) => x.id === selected);
            void removeOne(selected, n?.name || selected);
          }}
        >
          <Trash2 size={13} /> {t('删除')}
        </button>
        {checked.size > 0 && (
          <>
            <div style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 4px' }} />
            <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{t('已选')}{checked.size}</span>
            <button className="btn danger" onClick={() => void removeMany([...checked])}>
              <Trash2 size={13} /> {t('批量删除')}
            </button>
            <button className="btn ghost" onClick={() => setChecked(new Set())}>
              {t('清除选择')}
            </button>
          </>
        )}
        <div style={{ flex: 1 }} />
        <div style={{ position: 'relative' }}>
          <Search size={13} style={{ position: 'absolute', left: 8, top: 8, color: 'var(--text-muted)' }} />
          <input
            ref={filterRef}
            className="search-input"
            style={{ paddingLeft: 26 }}
            placeholder={t('过滤网络（Ctrl+F）')}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      </div>

      {error && <ListError error={error} onRetry={() => void load()} />}

      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {loading && list.length === 0 && !error ? (
          <ListLoading label={t('正在加载网络…')} />
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <p>{list.length === 0 ? t('暂无网络') : t('没有匹配的网络')}</p>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 28 }}>
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={() =>
                      setChecked(allChecked ? new Set() : new Set(filtered.map((n) => n.id)))
                    }
                    style={{ width: 12, height: 12 }}
                  />
                </th>
                <SortableTh label={t('名称')} active={sortKey === 'name'} asc={sortAsc} onSort={() => toggleSort('name')} />
                <SortableTh label={'ID'} active={sortKey === 'id'} asc={sortAsc} onSort={() => toggleSort('id')} />
                <SortableTh label={t('驱动')} active={sortKey === 'driver'} asc={sortAsc} onSort={() => toggleSort('driver')} />
                <SortableTh label={t('作用域')} active={sortKey === 'scope'} asc={sortAsc} onSort={() => toggleSort('scope')} />
                <SortableTh label={t('子网')} active={sortKey === 'subnet'} asc={sortAsc} onSort={() => toggleSort('subnet')} />
                <th>{t('容器')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((n) => (
                <Fragment key={n.id}>
                  <tr
                    className={`${selected === n.id ? 'selected' : ''} ${checked.has(n.id) ? 'checked' : ''}`}
                    onClick={(e) => {
                      if (e.ctrlKey || e.metaKey) {
                        toggleChecked(n.id);
                        setSelected(n.id);
                        return;
                      }
                      setSelected(n.id);
                    }}
                    onDoubleClick={() => setExpanded(expanded === n.id ? null : n.id)}
                    onContextMenu={(e) => {
                      setSelected(n.id);
                      if (!checked.has(n.id)) setChecked(new Set([n.id]));
                      ctx.open(e, rowMenu(n));
                    }}
                  >
                    <td>
                      <input
                        type="checkbox"
                        checked={checked.has(n.id)}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => toggleChecked(n.id)}
                        style={{ width: 12, height: 12 }}
                      />
                    </td>
                    <td style={{ color: 'var(--text-bright)' }}>{n.name}</td>
                    <td className="mono" style={{ color: 'var(--text-dim)' }}>
                      {n.id.slice(0, 12)}
                    </td>
                    <td>
                      <span
                        className="chip"
                        style={{ background: 'rgba(198,120,221,0.15)', color: 'var(--network)' }}
                        title={n.driver}
                      >
                        {localizeNetworkDriver(n.driver)}
                      </span>
                    </td>
                    <td>{localizeScope(n.scope)}</td>
                    <td className="mono">{n.subnet || '-'}</td>
                    <td>
                      <button
                        className="btn ghost"
                        style={{ height: 22, fontSize: 11 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpanded(expanded === n.id ? null : n.id);
                        }}
                      >
                        {n.containers.length} {t('个')}
                      </button>
                    </td>
                  </tr>
                  {expanded === n.id && (
                    <tr style={{ cursor: 'default' }}>
                      <td colSpan={7} style={{ background: 'var(--bg-panel-alt)' }}>
                        {n.containers.length === 0 ? (
                          <div style={{ color: 'var(--text-muted)', fontSize: 11, padding: 4 }}>
                            {t('该网络上没有已连接的容器')}
                          </div>
                        ) : (
                          <table className="table" style={{ background: 'transparent' }}>
                            <thead>
                              <tr>
                                <th>{t('容器')}</th>
                                <th>IPv4</th>
                                <th>IPv6</th>
                                <th>MAC</th>
                              </tr>
                            </thead>
                            <tbody>
                              {n.containers.map((c) => (
                                <tr key={c.name} style={{ cursor: 'default' }}>
                                  <td>{c.name}</td>
                                  <td className="mono">{c.ipv4 || '-'}</td>
                                  <td className="mono">{c.ipv6 || '-'}</td>
                                  <td className="mono">{c.mac || '-'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {createOpen && (
        <CreateNetworkDialog
          hostId={hostId}
          onClose={() => setCreateOpen(false)}
          onCreated={async () => {
            setCreateOpen(false);
            toast(t('网络已创建'), 'success');
            await load();
          }}
        />
      )}
      {confirmDialog}
      {ctx.menu && <ContextMenu state={ctx.menu} onClose={ctx.close} />}
    </div>
  );
}
