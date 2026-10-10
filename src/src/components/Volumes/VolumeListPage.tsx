import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { RefreshCw, Trash2, Search, Plus, ArrowUp, ArrowDown, Copy, X } from 'lucide-react';
import type { VolumeSummary } from '../../types/docker';
import { useAppStore } from '../../stores/appStore';
import { reportError } from '../../utils/connection';
import { useConfirm } from '../../utils/useConfirm';
import { useHotkeys } from '../../utils/useHotkeys';
import { loadUiPref, saveUiPref } from '../../utils/uiPrefs';
import { localizeVolumeDriver, localizeScope } from '../../utils/localize';
import { CreateVolumeDialog } from './CreateVolumeDialog';
import { ContextMenu, useContextMenu, type ContextMenuItem } from '../common/ContextMenu';
import { ListError, ListLoading } from '../common/ListFeedback';
import { SortableTh } from '../common/SortableTh';
import { fmtTimeAgo, fmtAbsolute } from '../../utils/format';
import { t, useT } from '../../i18n';

type SortKey = 'name' | 'driver' | 'mountpoint' | 'scope' | 'created';

export function VolumeListPage({ hostId, active = true }: { hostId: string; active?: boolean }) {
  const t = useT();
  const toast = useAppStore((s) => s.toast);
  const setRefreshing = useAppStore((s) => s.setRefreshing);
  const containersVersion = useAppStore((s) => s.containersVersion);
  const [list, setList] = useState<VolumeSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState(() => loadUiPref('volumes.filter', ''));
  const [selected, setSelected] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>(() => loadUiPref('volumes.sortKey', 'name'));
  const [sortAsc, setSortAsc] = useState(() => loadUiPref('volumes.sortAsc', true));
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
      const data = await window.dockerApi.listVolumes(hostId);
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
    saveUiPref('volumes.filter', filter);
  }, [filter]);
  useEffect(() => {
    saveUiPref('volumes.sortKey', sortKey);
    saveUiPref('volumes.sortAsc', sortAsc);
  }, [sortKey, sortAsc]);

  useEffect(() => {
    if (containersVersion > 0) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containersVersion]);

  const filtered = useMemo(() => {
    const rows = list.filter((v) => {
      if (!filter) return true;
      const q = filter.toLowerCase();
      return (
        v.name.toLowerCase().includes(q) ||
        v.driver.toLowerCase().includes(q) ||
        v.mountpoint.toLowerCase().includes(q)
      );
    });
    const dir = sortAsc ? 1 : -1;
    return [...rows].sort((a, b) => {
      switch (sortKey) {
        case 'name':
          return dir * a.name.localeCompare(b.name);
        case 'driver':
          return dir * a.driver.localeCompare(b.driver);
        case 'mountpoint':
          return dir * a.mountpoint.localeCompare(b.mountpoint);
        case 'scope':
          return dir * a.scope.localeCompare(b.scope);
        case 'created':
          return dir * (new Date(a.created || 0).getTime() - new Date(b.created || 0).getTime());
        default:
          return 0;
      }
    });
  }, [list, filter, sortKey, sortAsc]);

  const allChecked = filtered.length > 0 && filtered.every((v) => checked.has(v.name));

  const toggleChecked = (name: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
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

  const removeOne = async (name: string) => {
    const ok = await confirm({
      title: t('删除数据卷'),
      message: t("确认删除数据卷「{p0}」？卷中数据将永久丢失。", { p0: name }),
      confirmLabel: t('删除'),
      danger: true,
    });
    if (!ok) return;
    try {
      await window.dockerApi.removeVolume(hostId, name, true);
      toast(t('数据卷已删除'), 'success');
      setSelected(null);
      setChecked((prev) => {
        const next = new Set(prev);
        next.delete(name);
        return next;
      });
      await load();
    } catch (e) {
      reportError(e, toast);
    }
  };

  const removeMany = async (names: string[]) => {
    const ok = await confirm({
      title: t('批量删除数据卷'),
      message: t("确认删除选中的 {p0} 个数据卷？卷中数据将永久丢失。", { p0: names.length }),
      confirmLabel: t('删除'),
      danger: true,
    });
    if (!ok) return;
    let okCount = 0;
    for (const name of names) {
      try {
        await window.dockerApi.removeVolume(hostId, name, true);
        okCount++;
      } catch {
        /* keep going */
      }
    }
    toast(t("已删除 {p0}/{p1} 个数据卷", { p0: okCount, p1: names.length }), okCount === names.length ? 'success' : 'error');
    setChecked(new Set());
    setSelected(null);
    await load();
  };

  useHotkeys({
    'mod+f': () => filterRef.current?.focus(),
    f5: () => void load(),
    'mod+a': () => {
      if (filtered.length === 0) return;
      setChecked(new Set(filtered.map((v) => v.name)));
    },
    escape: () => setChecked(new Set()),
    arrowdown: () => {
      if (filtered.length === 0) return;
      const idx = selected ? filtered.findIndex((v) => v.name === selected) : -1;
      const next = filtered[Math.min(idx + 1, filtered.length - 1)] ?? filtered[0];
      setSelected(next.name);
    },
    arrowup: () => {
      if (filtered.length === 0) return;
      const idx = selected ? filtered.findIndex((v) => v.name === selected) : filtered.length;
      const next = filtered[Math.max(idx - 1, 0)] ?? filtered[0];
      setSelected(next.name);
    },
    delete: () => {
      const names = checked.size > 0 ? [...checked] : selected ? [selected] : [];
      if (names.length === 0) return;
      void (names.length === 1 ? removeOne(names[0]) : removeMany(names));
    },
  }, active);

  const rowMenu = (v: VolumeSummary): ContextMenuItem[] => {
    const ids = checked.has(v.name) && checked.size > 1 ? [...checked] : [v.name];
    const multi = ids.length > 1;
    return [
      {
        key: 'copy',
        label: t('复制卷名'),
        icon: <Copy size={13} />,
        disabled: multi,
        onSelect: () => {
          void navigator.clipboard?.writeText(v.name);
          toast(t('已复制数据卷名'), 'info');
        },
      },
      {
        key: 'copyPath',
        label: t('复制挂载点'),
        disabled: multi,
        onSelect: () => {
          void navigator.clipboard?.writeText(v.mountpoint);
          toast(t('已复制挂载点'), 'info');
        },
      },
      { key: 'sep', label: '', separator: true, onSelect: () => {} },
      {
        key: 'del',
        label: multi ? t("删除 {p0} 个…", { p0: ids.length }) : t('删除…'),
        icon: <Trash2 size={13} />,
        danger: true,
        onSelect: () => void (multi ? removeMany(ids) : removeOne(v.name)),
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
          <Plus size={13} /> {t('创建数据卷')}
        </button>
        <button className="btn" onClick={load} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'spinner' : ''} /> {t('刷新')}
        </button>
        <button
          className="btn danger"
          disabled={!selected}
          onClick={() => {
            if (!selected) return;
            void removeOne(selected);
          }}
        >
          <Trash2 size={13} /> {t('删除')}
        </button>
        {checked.size > 0 && (
          <>
            <div style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 4px' }} />
            <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{t('已选')} {checked.size}</span>
            <button className="btn danger" onClick={() => void removeMany([...checked])}>
              <Trash2 size={13} /> {t('批量删除')}
            </button>
            <button className="btn ghost" onClick={() => setChecked(new Set())}>
              {t('清除选择')}
            </button>
          </>
        )}
        {filter && (
          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            {filtered.length}/{list.length} {t('个数据卷')}
          </span>
        )}
        <div style={{ flex: 1 }} />
        <div style={{ position: 'relative' }}>
          <Search size={13} style={{ position: 'absolute', left: 8, top: 8, color: 'var(--text-muted)' }} />
          <input
            ref={filterRef}
            className="search-input"
            style={{ paddingLeft: 26, paddingRight: filter ? 26 : undefined }}
            placeholder={t('过滤数据卷（Ctrl+F）')}
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

      {error && <ListError error={error} onRetry={() => void load()} />}

      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {loading && list.length === 0 && !error ? (
          <ListLoading label={t('正在加载数据卷…')} />
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <p>{list.length === 0 ? t('暂无数据卷') : t('没有匹配的数据卷')}</p>
            {list.length > 0 && (
              <button className="btn ghost" onClick={() => setFilter('')}>
                <X size={12} /> {t('清除过滤')}
              </button>
            )}
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
                      setChecked(allChecked ? new Set() : new Set(filtered.map((v) => v.name)))
                    }
                    style={{ width: 12, height: 12 }}
                  />
                </th>
                <SortableTh label={t('名称')} active={sortKey === 'name'} asc={sortAsc} onSort={() => toggleSort('name')} />
                <SortableTh label={t('驱动')} active={sortKey === 'driver'} asc={sortAsc} onSort={() => toggleSort('driver')} />
                <SortableTh label={t('挂载点')} active={sortKey === 'mountpoint'} asc={sortAsc} onSort={() => toggleSort('mountpoint')} />
                <SortableTh label={t('作用域')} active={sortKey === 'scope'} asc={sortAsc} onSort={() => toggleSort('scope')} />
                <SortableTh label={t('创建时间')} active={sortKey === 'created'} asc={sortAsc} onSort={() => toggleSort('created')} />
              </tr>
            </thead>
            <tbody>
              {filtered.map((v) => (
                <tr
                  key={v.name}
                  className={`${selected === v.name ? 'selected' : ''} ${checked.has(v.name) ? 'checked' : ''}`}
                  onClick={(e) => {
                    if (e.ctrlKey || e.metaKey) {
                      toggleChecked(v.name);
                      setSelected(v.name);
                      return;
                    }
                    setSelected(v.name);
                  }}
                  onContextMenu={(e) => {
                    setSelected(v.name);
                    if (!checked.has(v.name)) setChecked(new Set([v.name]));
                    ctx.open(e, rowMenu(v));
                  }}
                >
                  <td>
                    <input
                      type="checkbox"
                      checked={checked.has(v.name)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggleChecked(v.name)}
                      style={{ width: 12, height: 12 }}
                    />
                  </td>
                  <td
                    style={{
                      color: 'var(--text-bright)',
                      maxWidth: 200,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={v.name}
                  >
                    {v.name}
                  </td>
                  <td>
                    <span
                      className="chip"
                      style={{ background: 'rgba(224,108,117,0.15)', color: 'var(--volume)' }}
                      title={v.driver}
                    >
                      {localizeVolumeDriver(v.driver)}
                    </span>
                  </td>
                  <td
                    className="mono"
                    title={v.mountpoint}
                    style={{
                      color: 'var(--text-dim)',
                      fontSize: 11,
                      maxWidth: 280,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {v.mountpoint}
                  </td>
                  <td>{localizeScope(v.scope)}</td>
                  <td
                    style={{ color: 'var(--text-muted)', fontSize: 11, whiteSpace: 'nowrap' }}
                    title={fmtAbsolute(v.created)}
                  >
                    {fmtTimeAgo(v.created)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {createOpen && (
        <CreateVolumeDialog
          hostId={hostId}
          onClose={() => setCreateOpen(false)}
          onCreated={async () => {
            setCreateOpen(false);
            toast(t('数据卷已创建'), 'success');
            await load();
          }}
        />
      )}
      {confirmDialog}
      {ctx.menu && <ContextMenu state={ctx.menu} onClose={ctx.close} />}
    </div>
  );
}
