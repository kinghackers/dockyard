import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { RefreshCw, Trash2, Search, Plus, ArrowUp, ArrowDown, Copy } from 'lucide-react';
import type { VolumeSummary } from '../../types/docker';
import { useAppStore } from '../../stores/appStore';
import { reportError } from '../../utils/connection';
import { useConfirm } from '../../utils/useConfirm';
import { useHotkeys } from '../../utils/useHotkeys';
import { localizeVolumeDriver, localizeScope } from '../../utils/localize';
import { CreateVolumeDialog } from './CreateVolumeDialog';
import { ContextMenu, useContextMenu, type ContextMenuItem } from '../common/ContextMenu';

type SortKey = 'name' | 'driver' | 'mountpoint' | 'scope' | 'created';

export function VolumeListPage({ hostId }: { hostId: string }) {
  const { toast, containersVersion } = useAppStore();
  const [list, setList] = useState<VolumeSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortAsc, setSortAsc] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmDialog, confirm] = useConfirm();
  const filterRef = useRef<HTMLInputElement>(null);
  const ctx = useContextMenu();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await window.dockerApi.listVolumes(hostId);
      setList(data);
    } catch (e) {
      reportError(e, toast);
    } finally {
      setLoading(false);
    }
  }, [hostId, toast]);

  useEffect(() => {
    void load();
  }, [load]);

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
      title: '删除数据卷',
      message: `确认删除数据卷「${name}」？卷中数据将永久丢失。`,
      confirmLabel: '删除',
      danger: true,
    });
    if (!ok) return;
    try {
      await window.dockerApi.removeVolume(hostId, name, true);
      toast('数据卷已删除', 'success');
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
      title: '批量删除数据卷',
      message: `确认删除选中的 ${names.length} 个数据卷？卷中数据将永久丢失。`,
      confirmLabel: '删除',
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
    toast(`已删除 ${okCount}/${names.length} 个数据卷`, okCount === names.length ? 'success' : 'error');
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
    delete: () => {
      const names = checked.size > 0 ? [...checked] : selected ? [selected] : [];
      if (names.length === 0) return;
      void (names.length === 1 ? removeOne(names[0]) : removeMany(names));
    },
  });

  const rowMenu = (v: VolumeSummary): ContextMenuItem[] => {
    const ids = checked.has(v.name) && checked.size > 1 ? [...checked] : [v.name];
    const multi = ids.length > 1;
    return [
      {
        key: 'copy',
        label: '复制卷名',
        icon: <Copy size={13} />,
        disabled: multi,
        onSelect: () => {
          void navigator.clipboard?.writeText(v.name);
          toast('已复制数据卷名', 'info');
        },
      },
      {
        key: 'copyPath',
        label: '复制挂载点',
        disabled: multi,
        onSelect: () => {
          void navigator.clipboard?.writeText(v.mountpoint);
          toast('已复制挂载点', 'info');
        },
      },
      { key: 'sep', label: '', separator: true, onSelect: () => {} },
      {
        key: 'del',
        label: multi ? `删除 ${ids.length} 个…` : '删除…',
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
          <Plus size={13} /> 创建数据卷
        </button>
        <button className="btn" onClick={load} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'spinner' : ''} /> 刷新
        </button>
        <button
          className="btn danger"
          disabled={!selected}
          onClick={() => {
            if (!selected) return;
            void removeOne(selected);
          }}
        >
          <Trash2 size={13} /> 删除
        </button>
        {checked.size > 1 && (
          <>
            <div style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 4px' }} />
            <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>已选 {checked.size}</span>
            <button className="btn danger" onClick={() => void removeMany([...checked])}>
              <Trash2 size={13} /> 批量删除
            </button>
            <button className="btn ghost" onClick={() => setChecked(new Set())}>
              清除选择
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
            placeholder="过滤数据卷（Ctrl+F）"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {filtered.length === 0 ? (
          <div className="empty-state">
            <p>{list.length === 0 ? '暂无数据卷' : '没有匹配的数据卷'}</p>
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
                <th className="sortable" onClick={() => toggleSort('name')}>
                  名称{sortInd('name')}
                </th>
                <th className="sortable" onClick={() => toggleSort('driver')}>
                  驱动{sortInd('driver')}
                </th>
                <th className="sortable" onClick={() => toggleSort('mountpoint')}>
                  挂载点{sortInd('mountpoint')}
                </th>
                <th className="sortable" onClick={() => toggleSort('scope')}>
                  作用域{sortInd('scope')}
                </th>
                <th className="sortable" onClick={() => toggleSort('created')}>
                  创建时间{sortInd('created')}
                </th>
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
                  <td style={{ color: 'var(--text-bright)' }}>{v.name}</td>
                  <td>
                    <span
                      className="chip"
                      style={{ background: 'rgba(224,108,117,0.15)', color: 'var(--volume)' }}
                      title={v.driver}
                    >
                      {localizeVolumeDriver(v.driver)}
                    </span>
                  </td>
                  <td className="mono" style={{ color: 'var(--text-dim)', fontSize: 11 }}>
                    {v.mountpoint}
                  </td>
                  <td>{localizeScope(v.scope)}</td>
                  <td style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                    {v.created ? new Date(v.created).toLocaleString() : '-'}
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
            toast('数据卷已创建', 'success');
            await load();
          }}
        />
      )}
      {confirmDialog}
      {ctx.menu && <ContextMenu state={ctx.menu} onClose={ctx.close} />}
    </div>
  );
}
