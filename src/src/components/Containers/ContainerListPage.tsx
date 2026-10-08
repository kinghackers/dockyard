import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  RefreshCw,
  Play,
  Square,
  RotateCw,
  Trash2,
  FileText,
  Terminal as TermIcon,
  Search,
  Pause,
  PlayCircle,
  Plus,
  Skull,
  ArrowUp,
  ArrowDown,
  Copy,
  Info,
} from 'lucide-react';
import type { ContainerSummary } from '../../types/docker';
import { useAppStore } from '../../stores/appStore';
import { reportError } from '../../utils/connection';
import { runAction } from '../../utils/runAction';
import { useConfirm } from '../../utils/useConfirm';
import { useHotkeys } from '../../utils/useHotkeys';
import { localizeStatusChip, localizeContainerStatus, statusChipExtraClass } from '../../utils/localize';
import { formatPortMappings } from '../../utils/ports';
import { getContainerActions } from '../../utils/containerActions';
import { loadUiPref, saveUiPref } from '../../utils/uiPrefs';
import { RunContainerDialog } from './RunContainerDialog';
import { ContainerRowActions } from './ContainerRowActions';
import { ContextMenu, useContextMenu, type ContextMenuItem } from '../common/ContextMenu';
import { ListError, ListLoading } from '../common/ListFeedback';

type SortKey = 'name' | 'state' | 'image' | 'project' | 'created';

/** stable empty list so the store selector returns the same reference when a host has no data yet */
const EMPTY_LIST: ContainerSummary[] = [];

export function ContainerListPage({ hostId }: { hostId: string }) {
  const openTab = useAppStore((s) => s.openTab);
  const toast = useAppStore((s) => s.toast);
  const setContainers = useAppStore((s) => s.setContainers);
  const setRefreshing = useAppStore((s) => s.setRefreshing);
  const list = useAppStore((s) => s.containersByHost[hostId] || EMPTY_LIST);
  const containersVersion = useAppStore((s) => s.containersVersion);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState(() => loadUiPref('containers.filter', ''));
  const [stateFilter, setStateFilter] = useState<'all' | 'running' | 'exited' | 'paused' | 'restarting'>(
    () => loadUiPref('containers.stateFilter', 'all')
  );
  const [selected, setSelected] = useState<string | null>(null);
  /** multi-select ids (checkbox). `selected` remains the focus row for toolbar actions. */
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>(() => loadUiPref('containers.sortKey', 'created'));
  const [sortAsc, setSortAsc] = useState(() => loadUiPref('containers.sortAsc', false));
  const [runOpen, setRunOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDialog, confirm] = useConfirm();
  const ctx = useContextMenu();
  const filterRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setRefreshing(true);
    setError(null);
    try {
      const data = await window.dockerApi.listContainers(hostId, true, true);
      setContainers(hostId, data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [hostId, setContainers, setRefreshing]);

  useEffect(() => {
    void load();
  }, [load]);

  // remember list filter / sort across sessions
  useEffect(() => {
    saveUiPref('containers.filter', filter);
  }, [filter]);
  useEffect(() => {
    saveUiPref('containers.stateFilter', stateFilter);
  }, [stateFilter]);
  useEffect(() => {
    saveUiPref('containers.sortKey', sortKey);
    saveUiPref('containers.sortAsc', sortAsc);
  }, [sortKey, sortAsc]);

  // auto-refresh when docker events fire
  useEffect(() => {
    if (containersVersion > 0) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containersVersion]);

  const filtered = useMemo(() => {
    const rows = list.filter((c) => {
      if (stateFilter !== 'all' && c.state !== stateFilter) return false;
      if (!filter) return true;
      const q = filter.toLowerCase();
      return (
        c.name.toLowerCase().includes(q) ||
        c.image.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q) ||
        (c.composeProject || '').toLowerCase().includes(q)
      );
    });
    const dir = sortAsc ? 1 : -1;
    return [...rows].sort((a, b) => {
      switch (sortKey) {
        case 'name':
          return dir * a.name.localeCompare(b.name);
        case 'state':
          return dir * a.state.localeCompare(b.state);
        case 'image':
          return dir * a.image.localeCompare(b.image);
        case 'project':
          return dir * (a.composeProject || '').localeCompare(b.composeProject || '');
        case 'created':
          return dir * (a.created - b.created);
        default:
          return 0;
      }
    });
  }, [list, filter, stateFilter, sortKey, sortAsc]);

  // ---- windowed rendering for large hosts ----
  // rows are fixed-height (single-line cells with ellipsis), so we render a
  // viewport slice with spacer rows instead of thousands of <tr> at once
  const scrollRef = useRef<HTMLDivElement>(null);
  const firstRowRef = useRef<HTMLTableRowElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(() => Math.max(900, window.innerHeight));
  const [rowH, setRowH] = useState(43);

  // correct the row-height estimate once a real row exists
  useEffect(() => {
    const h = firstRowRef.current?.getBoundingClientRect().height;
    if (h && Math.abs(h - rowH) > 0.5) setRowH(h);
  });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setViewportH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const WINDOW_MIN_ROWS = 150;
  const OVERSCAN = 10;
  const windowed = filtered.length > WINDOW_MIN_ROWS;
  const startIdx = windowed
    ? Math.max(0, Math.floor(scrollTop / rowH) - OVERSCAN)
    : 0;
  const endIdx = windowed
    ? Math.min(filtered.length, Math.ceil((scrollTop + viewportH) / rowH) + OVERSCAN)
    : filtered.length;
  const visibleRows = windowed ? filtered.slice(startIdx, endIdx) : filtered;

  const handleListScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
    setViewportH(e.currentTarget.clientHeight);
  };

  const action = async (fn: () => Promise<unknown>, okMsg: string, pendingMsg = '处理中…') => {
    await runAction(toast, { pending: pendingMsg, ok: okMsg }, fn);
    await load();
  };

  const runOn = (
    ids: string[],
    fn: (id: string) => Promise<unknown>,
    okMsg: string,
    pendingMsg = '处理中…'
  ) =>
    action(
      async () => {
        for (const id of ids) await fn(id);
      },
      okMsg,
      pendingMsg
    );

  const selectedContainer = useMemo(
    () => list.find((c) => c.id === selected) || null,
    [list, selected]
  );
  const selActions = selectedContainer
    ? getContainerActions(selectedContainer.state, selectedContainer.status)
    : null;

  const allChecked = filtered.length > 0 && filtered.every((c) => checked.has(c.id));

  const toggleChecked = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setChecked(allChecked ? new Set() : new Set(filtered.map((c) => c.id)));
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else {
      setSortKey(key);
      setSortAsc(key === 'name' || key === 'image' || key === 'project');
    }
  };

  const openLogs = (id: string, name: string) => {
    openTab({
      id: `logs:${hostId}:${id}`,
      title: `日志 · ${name}`,
      kind: 'logs',
      hostId,
      containerId: id,
    });
  };

  const openTerminal = (id: string, name: string) => {
    openTab({
      id: `terminal:${hostId}:${id}`,
      title: `终端 · ${name}`,
      kind: 'terminal',
      hostId,
      containerId: id,
    });
  };

  const openDetail = (id: string, name: string) => {
    openTab({
      id: `containerDetail:${hostId}:${id}`,
      title: `容器: ${name}`,
      kind: 'containerDetail',
      hostId,
      containerId: id,
    });
  };

  const removeOne = async (id: string, name: string) => {
    const ok = await confirm({
      title: '删除容器',
      message: `确认删除容器「${name}」？数据卷将一并移除。`,
      confirmLabel: '删除',
      danger: true,
    });
    if (!ok) return;
    await action(() => window.dockerApi.removeContainer(hostId, id, true), '已删除');
    setChecked((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const removeMany = async (ids: string[]) => {
    const ok = await confirm({
      title: '批量删除容器',
      message: `确认删除选中的 ${ids.length} 个容器？数据卷将一并移除。`,
      confirmLabel: '删除',
      danger: true,
    });
    if (!ok) return;
    await runOn(ids, (id) => window.dockerApi.removeContainer(hostId, id, true), `已删除 ${ids.length} 个容器`);
    setChecked(new Set());
  };

  const stopRestartLoop = async (id: string, name: string) => {
    try {
      const result = await window.dockerApi.stopRestartLoop(hostId, id);
      toast(
        `${name}: ${
          result === 'killed'
            ? '已强制终止并关闭自动重启'
            : result === 'stopped'
              ? '已停止并关闭自动重启'
              : '已关闭自动重启'
        }`,
        'success'
      );
      await load();
    } catch (e) {
      reportError(e, toast);
    }
  };

  useHotkeys({
    'mod+f': () => filterRef.current?.focus(),
    f5: () => void load(),
    'mod+a': () => {
      if (filtered.length === 0) return;
      setChecked(new Set(filtered.map((c) => c.id)));
    },
    escape: () => setChecked(new Set()),
    arrowdown: () => {
      if (filtered.length === 0) return;
      const idx = selected ? filtered.findIndex((c) => c.id === selected) : -1;
      const next = filtered[Math.min(idx + 1, filtered.length - 1)] ?? filtered[0];
      setSelected(next.id);
    },
    arrowup: () => {
      if (filtered.length === 0) return;
      const idx = selected ? filtered.findIndex((c) => c.id === selected) : filtered.length;
      const next = filtered[Math.max(idx - 1, 0)] ?? filtered[0];
      setSelected(next.id);
    },
    enter: () => {
      if (!selected) return;
      const c = list.find((x) => x.id === selected);
      if (c) openDetail(c.id, c.name);
    },
    delete: () => {
      const ids = checked.size > 0 ? [...checked] : selected ? [selected] : [];
      if (ids.length === 0) return;
      const first = list.find((c) => c.id === ids[0]);
      void (ids.length === 1 && first
        ? removeOne(ids[0], first.name)
        : removeMany(ids));
    },
  });

  const rowMenu = (c: ContainerSummary): ContextMenuItem[] => {
    const a = getContainerActions(c.state, c.status);
    const ids = checked.has(c.id) && checked.size > 1 ? [...checked] : [c.id];
    const multi = ids.length > 1;
    const items: ContextMenuItem[] = [];

    if (a.canStart) {
      items.push({
        key: 'start',
        label: multi ? `启动 ${ids.length} 个` : '启动',
        icon: <Play size={13} />,
        onSelect: () =>
          void runOn(
            ids,
            (id) => window.dockerApi.startContainer(hostId, id),
            multi ? `已启动 ${ids.length} 个` : '已启动',
            multi ? `正在启动 ${ids.length} 个…` : `${c.name}: 正在启动…`
          ),
      });
    }
    if (a.canStop) {
      items.push({
        key: 'stop',
        label: multi ? `停止 ${ids.length} 个` : '停止',
        icon: <Square size={13} />,
        onSelect: () =>
          void runOn(
            ids,
            (id) => window.dockerApi.stopContainer(hostId, id),
            multi ? `已停止 ${ids.length} 个` : '已停止',
            multi ? `正在停止 ${ids.length} 个…` : `${c.name}: 正在停止…`
          ),
      });
    }
    if (a.canRestart) {
      items.push({
        key: 'restart',
        label: multi ? `重启 ${ids.length} 个` : '重启',
        icon: <RotateCw size={13} />,
        onSelect: () =>
          void runOn(
            ids,
            (id) => window.dockerApi.restartContainer(hostId, id),
            multi ? `已重启 ${ids.length} 个` : '已重启',
            multi ? `正在重启 ${ids.length} 个…` : `${c.name}: 正在重启…`
          ),
      });
    }
    if (a.canKill && !multi) {
      items.push({
        key: 'kill',
        label: '强制终止',
        icon: <Skull size={13} />,
        onSelect: () =>
          void action(
            () => window.dockerApi.killContainer(hostId, c.id),
            '已强制终止',
            `${c.name}: 正在强杀…`
          ),
      });
    }
    if (a.isRestartLoop && !multi) {
      items.push({
        key: 'loop',
        label: '停止重启循环',
        onSelect: () => void stopRestartLoop(c.id, c.name),
      });
    }

    items.push({ key: 'sep1', label: '', separator: true, onSelect: () => {} });
    items.push({
      key: 'logs',
      label: '查看日志',
      icon: <FileText size={13} />,
      disabled: multi,
      onSelect: () => openLogs(c.id, c.name),
    });
    items.push({
      key: 'term',
      label: '打开终端',
      icon: <TermIcon size={13} />,
      disabled: multi || !a.canExec,
      onSelect: () => openTerminal(c.id, c.name),
    });
    items.push({
      key: 'detail',
      label: '打开详情',
      icon: <Info size={13} />,
      disabled: multi,
      onSelect: () => openDetail(c.id, c.name),
    });
    items.push({
      key: 'copy',
      label: '复制容器 ID',
      icon: <Copy size={13} />,
      disabled: multi,
      onSelect: () => {
        void navigator.clipboard?.writeText(c.id);
        toast('已复制容器 ID', 'info');
      },
    });
    items.push({ key: 'sep2', label: '', separator: true, onSelect: () => {} });
    items.push({
      key: 'del',
      label: multi ? `删除 ${ids.length} 个…` : '删除…',
      icon: <Trash2 size={13} />,
      danger: true,
      onSelect: () => void (multi ? removeMany(ids) : removeOne(c.id, c.name)),
    });
    return items;
  };

  const sortInd = (key: SortKey) =>
    sortKey === key ? <span className="sort-ind">{sortAsc ? <ArrowUp size={11} /> : <ArrowDown size={11} />}</span> : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div className="content-toolbar">
        <button className="btn primary" onClick={() => setRunOpen(true)}>
          <Plus size={13} /> 创建容器
        </button>
        <button className="btn" onClick={load} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'spinner' : ''} /> 刷新
        </button>
        <button
          className="btn"
          disabled={!selected || !selActions?.canStart}
          onClick={() =>
            selected &&
            action(
              () => window.dockerApi.startContainer(hostId, selected),
              '已启动',
              '正在启动…'
            )
          }
        >
          <Play size={13} /> 启动
        </button>
        <button
          className="btn"
          disabled={!selected || !selActions?.canStop}
          onClick={() =>
            selected &&
            action(
              () => window.dockerApi.stopContainer(hostId, selected),
              '已停止',
              '正在停止…'
            )
          }
        >
          <Square size={13} /> 停止
        </button>
        <button
          className="btn"
          disabled={!selected || !selActions?.canRestart}
          onClick={() =>
            selected &&
            action(
              () => window.dockerApi.restartContainer(hostId, selected),
              '已重启',
              '正在重启…'
            )
          }
        >
          <RotateCw size={13} /> 重启
        </button>
        <button
          className="btn"
          disabled={!selected || !selActions?.canPause}
          onClick={() =>
            selected &&
            action(
              () => window.dockerApi.pauseContainer(hostId, selected),
              '已暂停',
              '正在暂停…'
            )
          }
        >
          <Pause size={13} /> 暂停
        </button>
        <button
          className="btn"
          disabled={!selected || !selActions?.canUnpause}
          onClick={() =>
            selected &&
            action(
              () => window.dockerApi.unpauseContainer(hostId, selected),
              '已恢复',
              '正在恢复…'
            )
          }
        >
          <PlayCircle size={13} /> 恢复
        </button>
        <button
          className="btn"
          disabled={!selected || !selActions?.canKill}
          title="强制终止"
          onClick={() =>
            selected &&
            action(
              () => window.dockerApi.killContainer(hostId, selected),
              '已强制终止',
              '正在强杀…'
            )
          }
        >
          <Skull size={13} /> 强杀
        </button>
        <button
          className="btn"
          disabled={!selected || !selActions?.canLogs}
          onClick={() => {
            if (!selected) return;
            openLogs(selected, list.find((c) => c.id === selected)?.name || '');
          }}
        >
          <FileText size={13} /> 日志
        </button>
        <button
          className="btn"
          disabled={!selected || !selActions?.canExec}
          title={selected && !selActions?.canExec ? '仅运行中的容器可打开终端' : '打开终端'}
          onClick={() => {
            if (!selected) return;
            openTerminal(selected, list.find((c) => c.id === selected)?.name || '');
          }}
        >
          <TermIcon size={13} /> 终端
        </button>
        <button
          className="btn danger"
          disabled={!selected || !selActions?.canRemove}
          onClick={() => {
            if (!selected) return;
            void removeOne(selected, selectedContainer?.name || selected);
          }}
        >
          <Trash2 size={13} /> 删除
        </button>
        {checked.size > 1 && (
          <>
            <div style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 4px' }} />
            <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>已选 {checked.size}</span>
            <button
              className="btn"
              onClick={() =>
                runOn(
                  [...checked],
                  (id) => window.dockerApi.startContainer(hostId, id),
                  `已启动 ${checked.size} 个`
                )
              }
            >
              <Play size={13} /> 批量启动
            </button>
            <button
              className="btn"
              onClick={() =>
                runOn(
                  [...checked],
                  (id) => window.dockerApi.stopContainer(hostId, id),
                  `已停止 ${checked.size} 个`
                )
              }
            >
              <Square size={13} /> 批量停止
            </button>
            <button
              className="btn danger"
              onClick={() => void removeMany([...checked])}
            >
              <Trash2 size={13} /> 批量删除
            </button>
            <button className="btn ghost" onClick={() => setChecked(new Set())}>
              清除选择
            </button>
          </>
        )}
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value as typeof stateFilter)}
            style={{ height: 28 }}
          >
            <option value="all">全部状态</option>
            <option value="running">运行中</option>
            <option value="exited">已退出</option>
            <option value="paused">已暂停</option>
            <option value="restarting">重启中</option>
          </select>
          <div style={{ position: 'relative' }}>
            <Search
              size={13}
              style={{
                position: 'absolute',
                left: 8,
                top: 8,
                color: 'var(--text-muted)',
              }}
            />
            <input
              ref={filterRef}
              className="search-input"
              style={{ paddingLeft: 26 }}
              placeholder="过滤名称 / 镜像 / 项目（Ctrl+F）"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
        </div>
      </div>

      {error && <ListError error={error} onRetry={() => void load()} />}

      <div
        ref={scrollRef}
        style={{ flex: 1, overflow: 'auto', minHeight: 0 }}
        onScroll={windowed ? handleListScroll : undefined}
      >
        {loading && list.length === 0 && !error ? (
          <ListLoading label="正在加载容器…" />
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <p>{list.length === 0 ? '暂无容器' : '没有匹配的容器'}</p>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 28 }}>
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={toggleAll}
                    style={{ width: 12, height: 12 }}
                  />
                </th>
                <th className="sortable" onClick={() => toggleSort('name')}>
                  名称{sortInd('name')}
                </th>
                <th className="sortable" onClick={() => toggleSort('state')}>
                  状态{sortInd('state')}
                </th>
                <th className="sortable" onClick={() => toggleSort('image')}>
                  镜像{sortInd('image')}
                </th>
                <th className="sortable" onClick={() => toggleSort('project')}>
                  项目{sortInd('project')}
                </th>
                <th>端口</th>
                <th className="sortable" onClick={() => toggleSort('created')}>
                  创建时间{sortInd('created')}
                </th>
                <th style={{ width: 140 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {windowed && startIdx > 0 && (
                <tr aria-hidden style={{ height: startIdx * rowH }}>
                  <td colSpan={8} style={{ padding: 0, border: 0 }} />
                </tr>
              )}
              {visibleRows.map((c, i) => (
                <tr
                  key={c.id}
                  ref={i === 0 ? firstRowRef : undefined}
                  className={`${selected === c.id ? 'selected' : ''} ${checked.has(c.id) ? 'checked' : ''}`}
                  onClick={(e) => {
                    // ctrl/cmd toggles multi-select; shift selects range; plain click focuses
                    if (e.ctrlKey || e.metaKey) {
                      toggleChecked(c.id);
                      setSelected(c.id);
                      return;
                    }
                    if (e.shiftKey && selected) {
                      const from = filtered.findIndex((x) => x.id === selected);
                      const to = filtered.findIndex((x) => x.id === c.id);
                      if (from >= 0 && to >= 0) {
                        const [a, b] = from < to ? [from, to] : [to, from];
                        setChecked((prev) => {
                          const next = new Set(prev);
                          for (let i = a; i <= b; i++) next.add(filtered[i].id);
                          return next;
                        });
                      }
                      setSelected(c.id);
                      return;
                    }
                    setSelected(c.id);
                  }}
                  onDoubleClick={() => openDetail(c.id, c.name)}
                  onContextMenu={(e) => {
                    setSelected(c.id);
                    if (!checked.has(c.id)) setChecked(new Set([c.id]));
                    ctx.open(e, rowMenu(c));
                  }}
                >
                  <td>
                    <input
                      type="checkbox"
                      checked={checked.has(c.id)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggleChecked(c.id)}
                      style={{ width: 12, height: 12 }}
                    />
                  </td>
                  <td
                    style={{
                      color: 'var(--text-bright)',
                      maxWidth: 280,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={c.name}
                  >
                    {c.name}
                  </td>
                  <td>
                    <span className={`chip ${c.state} ${statusChipExtraClass(c.status, c.state)}`}>
                      <span className="dot" />
                      <span title={localizeContainerStatus(c.status)}>
                        {localizeStatusChip(c.status, c.state)}
                      </span>
                    </span>
                  </td>
                  <td
                    className="mono"
                    title={c.image}
                    style={{
                      color: 'var(--text-dim)',
                      maxWidth: 220,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {c.image}
                  </td>
                  <td style={{ color: 'var(--compose)' }}>{c.composeProject || '-'}</td>
                  <td className="mono" style={{ fontSize: 11 }}>
                    {formatPortMappings(c.ports)}
                  </td>
                  <td style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                    {new Date(c.created * 1000).toLocaleString()}
                  </td>
                  <td>
                    <ContainerRowActions
                      container={c}
                      onStart={() =>
                        void action(
                          () => window.dockerApi.startContainer(hostId, c.id),
                          '已启动',
                          `${c.name}: 正在启动…`
                        )
                      }
                      onStop={() =>
                        void action(
                          () => window.dockerApi.stopContainer(hostId, c.id),
                          '已停止',
                          `${c.name}: 正在停止…`
                        )
                      }
                      onRestart={() =>
                        void action(
                          () => window.dockerApi.restartContainer(hostId, c.id),
                          '已重启',
                          `${c.name}: 正在重启…`
                        )
                      }
                      onPause={() =>
                        void action(
                          () => window.dockerApi.pauseContainer(hostId, c.id),
                          '已暂停',
                          `${c.name}: 正在暂停…`
                        )
                      }
                      onUnpause={() =>
                        void action(
                          () => window.dockerApi.unpauseContainer(hostId, c.id),
                          '已恢复',
                          `${c.name}: 正在恢复…`
                        )
                      }
                      onKill={() =>
                        void action(
                          () => window.dockerApi.killContainer(hostId, c.id),
                          '已强制终止',
                          `${c.name}: 正在强杀…`
                        )
                      }
                      onStopRestartLoop={() => void stopRestartLoop(c.id, c.name)}
                      extra={
                        <>
                          <button
                            className="btn ghost icon-btn"
                            title="日志"
                            onClick={(e) => {
                              e.stopPropagation();
                              openLogs(c.id, c.name);
                            }}
                          >
                            <FileText size={12} />
                          </button>
                          <button
                            className="btn ghost icon-btn danger-text"
                            title="删除"
                            onClick={(e) => {
                              e.stopPropagation();
                              void removeOne(c.id, c.name);
                            }}
                          >
                            <Trash2 size={12} />
                          </button>
                        </>
                      }
                    />
                  </td>
                </tr>
              ))}
              {windowed && endIdx < filtered.length && (
                <tr aria-hidden style={{ height: (filtered.length - endIdx) * rowH }}>
                  <td colSpan={8} style={{ padding: 0, border: 0 }} />
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {runOpen && (
        <RunContainerDialog
          hostId={hostId}
          onClose={() => setRunOpen(false)}
          onCreated={async (id) => {
            setRunOpen(false);
            toast('容器已创建', 'success');
            await load();
            setSelected(id);
          }}
        />
      )}
      {confirmDialog}
      {ctx.menu && <ContextMenu state={ctx.menu} onClose={ctx.close} />}
    </div>
  );
}
