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
  Pencil,
  X,
} from 'lucide-react';
import type { ContainerSummary } from '../../types/docker';
import { useAppStore } from '../../stores/appStore';
import { reportError } from '../../utils/connection';
import { runAction } from '../../utils/runAction';
import { useConfirm } from '../../utils/useConfirm';
import { useMultiSelect } from '../../hooks/useMultiSelect';
import { useHotkeys } from '../../utils/useHotkeys';
import { localizeStatusChip, localizeContainerStatus, statusChipExtraClass } from '../../utils/localize';
import { formatPortMappings } from '../../utils/ports';
import { getContainerActions, stopRestartLoop } from '../../utils/containerActions';
import { loadUiPref, saveUiPref } from '../../utils/uiPrefs';
import { RunContainerDialog } from './RunContainerDialog';
import { ContainerRowActions } from './ContainerRowActions';
import { ContextMenu, useContextMenu, type ContextMenuItem } from '../common/ContextMenu';
import { ListError, ListLoading } from '../common/ListFeedback';
import { SortableTh } from '../common/SortableTh';
import { InputDialog } from '../common/InputDialog';
import { fmtTimeAgo, fmtAbsolute } from '../../utils/format';
import { t, useT } from '../../i18n';

type SortKey = 'name' | 'state' | 'image' | 'project' | 'created';

/** stable empty list so the store selector returns the same reference when a host has no data yet */
const EMPTY_LIST: ContainerSummary[] = [];

export function ContainerListPage({ hostId }: { hostId: string }) {
  const t = useT();
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
  const {
    checked,
    toggle: toggleChecked,
    selectAll,
    clear: clearChecked,
    remove: uncheck,
    selectRange,
  } = useMultiSelect();
  const [sortKey, setSortKey] = useState<SortKey>(() => loadUiPref('containers.sortKey', 'created'));
  const [sortAsc, setSortAsc] = useState(() => loadUiPref('containers.sortAsc', false));
  const [runOpen, setRunOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renameFor, setRenameFor] = useState<ContainerSummary | null>(null);
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

  const action = async (fn: () => Promise<unknown>, okMsg: string, pendingMsg = t('处理中…')) => {
    await runAction(toast, { pending: pendingMsg, ok: okMsg }, fn);
    await load();
  };

  const runOn = (
    ids: string[],
    fn: (id: string) => Promise<unknown>,
    okMsg: string,
    pendingMsg = t('处理中…')
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

  const toggleAll = () => selectAll(allChecked ? [] : filtered.map((c) => c.id));

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
      title: t("日志 · {p0}", { p0: name }),
      kind: 'logs',
      hostId,
      containerId: id,
    });
  };

  const openTerminal = (id: string, name: string) => {
    openTab({
      id: `terminal:${hostId}:${id}`,
      title: t("终端 · {p0}", { p0: name }),
      kind: 'terminal',
      hostId,
      containerId: id,
    });
  };

  const openDetail = (id: string, name: string) => {
    openTab({
      id: `containerDetail:${hostId}:${id}`,
      title: t("容器: {p0}", { p0: name }),
      kind: 'containerDetail',
      hostId,
      containerId: id,
    });
  };

  const removeOne = async (id: string, name: string) => {
    const ok = await confirm({
      title: t('删除容器'),
      message: t("确认删除容器「{p0}」？数据卷将一并移除。", { p0: name }),
      confirmLabel: t('删除'),
      danger: true,
    });
    if (!ok) return;
    await action(() => window.dockerApi.removeContainer(hostId, id, true), t('已删除'));
    uncheck(id);
  };

  const removeMany = async (ids: string[]) => {
    const ok = await confirm({
      title: t('批量删除容器'),
      message: t("确认删除选中的 {p0} 个容器？数据卷将一并移除。", { p0: ids.length }),
      confirmLabel: t('删除'),
      danger: true,
    });
    if (!ok) return;
    await runOn(ids, (id) => window.dockerApi.removeContainer(hostId, id, true), t("已删除 {p0} 个容器", { p0: ids.length }));
    clearChecked();
  };

  const stopRestartLoopOne = async (id: string, name: string) => {
    try {
      const msg = await stopRestartLoop(hostId, id);
      toast(`${name}: ${msg}`, 'success');
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
      selectAll(filtered.map((c) => c.id));
    },
    escape: () => clearChecked(),
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
        label: multi ? t("启动 {p0} 个", { p0: ids.length }) : t('启动'),
        icon: <Play size={13} />,
        onSelect: () =>
          void runOn(
            ids,
            (id) => window.dockerApi.startContainer(hostId, id),
            multi ? t("已启动 {p0} 个", { p0: ids.length }) : t('已启动'),
            multi ? t("正在启动 {p0} 个…", { p0: ids.length }) : t("{p0}: 正在启动…", { p0: c.name })
          ),
      });
    }
    if (a.canStop) {
      items.push({
        key: 'stop',
        label: multi ? t("停止 {p0} 个", { p0: ids.length }) : t('停止'),
        icon: <Square size={13} />,
        onSelect: () =>
          void runOn(
            ids,
            (id) => window.dockerApi.stopContainer(hostId, id),
            multi ? t("已停止 {p0} 个", { p0: ids.length }) : t('已停止'),
            multi ? t("正在停止 {p0} 个…", { p0: ids.length }) : t("{p0}: 正在停止…", { p0: c.name })
          ),
      });
    }
    if (a.canRestart) {
      items.push({
        key: 'restart',
        label: multi ? t("重启 {p0} 个", { p0: ids.length }) : t('重启'),
        icon: <RotateCw size={13} />,
        onSelect: () =>
          void runOn(
            ids,
            (id) => window.dockerApi.restartContainer(hostId, id),
            multi ? t("已重启 {p0} 个", { p0: ids.length }) : t('已重启'),
            multi ? t("正在重启 {p0} 个…", { p0: ids.length }) : t("{p0}: 正在重启…", { p0: c.name })
          ),
      });
    }
    if (a.canKill && !multi) {
      items.push({
        key: 'kill',
        label: t('强制终止'),
        icon: <Skull size={13} />,
        onSelect: () =>
          void action(
            () => window.dockerApi.killContainer(hostId, c.id),
            t('已强制终止'),
            t("{p0}: 正在强杀…", { p0: c.name })
          ),
      });
    }
    if (a.canPause && !multi) {
      items.push({
        key: 'pause',
        label: t('暂停'),
        icon: <Pause size={13} />,
        onSelect: () =>
          void action(
            () => window.dockerApi.pauseContainer(hostId, c.id),
            t('已暂停'),
            t("{p0}: 正在暂停…", { p0: c.name })
          ),
      });
    }
    if (a.canUnpause && !multi) {
      items.push({
        key: 'unpause',
        label: t('恢复'),
        icon: <PlayCircle size={13} />,
        onSelect: () =>
          void action(
            () => window.dockerApi.unpauseContainer(hostId, c.id),
            t('已恢复'),
            t("{p0}: 正在恢复…", { p0: c.name })
          ),
      });
    }
    if (a.isRestartLoop && !multi) {
      items.push({
        key: 'loop',
        label: t('停止重启循环'),
        onSelect: () => void stopRestartLoopOne(c.id, c.name),
      });
    }

    items.push({ key: 'sep1', label: '', separator: true, onSelect: () => {} });
    items.push({
      key: 'logs',
      label: t('查看日志'),
      icon: <FileText size={13} />,
      disabled: multi,
      onSelect: () => openLogs(c.id, c.name),
    });
    items.push({
      key: 'term',
      label: t('打开终端'),
      icon: <TermIcon size={13} />,
      disabled: multi || !a.canExec,
      onSelect: () => openTerminal(c.id, c.name),
    });
    items.push({
      key: 'detail',
      label: t('打开详情'),
      icon: <Info size={13} />,
      disabled: multi,
      onSelect: () => openDetail(c.id, c.name),
    });
    items.push({
      key: 'copy',
      label: t('复制容器 ID'),
      icon: <Copy size={13} />,
      disabled: multi,
      onSelect: () => {
        void navigator.clipboard?.writeText(c.id);
        toast(t('已复制容器 ID'), 'info');
      },
    });
    items.push({
      key: 'rename',
      label: t('重命名…'),
      icon: <Pencil size={13} />,
      disabled: multi,
      onSelect: () => setRenameFor(c),
    });
    items.push({ key: 'sep2', label: '', separator: true, onSelect: () => {} });
    items.push({
      key: 'del',
      label: multi ? t("删除 {p0} 个…", { p0: ids.length }) : t('删除…'),
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
          <Plus size={13} /> {t('创建容器')}
        </button>
        <button className="btn" onClick={load} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'spinner' : ''} /> {t('刷新')}
        </button>
        <button
          className="btn"
          disabled={!selected || !selActions?.canStart}
          onClick={() =>
            selected &&
            action(
              () => window.dockerApi.startContainer(hostId, selected),
              t('已启动'),
              t('正在启动…')
            )
          }
        >
          <Play size={13} /> {t('启动')}
        </button>
        <button
          className="btn"
          disabled={!selected || !selActions?.canStop}
          onClick={() =>
            selected &&
            action(
              () => window.dockerApi.stopContainer(hostId, selected),
              t('已停止'),
              t('正在停止…')
            )
          }
        >
          <Square size={13} /> {t('停止')}
        </button>
        <button
          className="btn"
          disabled={!selected || !selActions?.canRestart}
          onClick={() =>
            selected &&
            action(
              () => window.dockerApi.restartContainer(hostId, selected),
              t('已重启'),
              t('正在重启…')
            )
          }
        >
          <RotateCw size={13} /> {t('重启')}
        </button>
        <button
          className="btn"
          disabled={!selected || !selActions?.canPause}
          onClick={() =>
            selected &&
            action(
              () => window.dockerApi.pauseContainer(hostId, selected),
              t('已暂停'),
              t('正在暂停…')
            )
          }
        >
          <Pause size={13} /> {t('暂停')}
        </button>
        <button
          className="btn"
          disabled={!selected || !selActions?.canUnpause}
          onClick={() =>
            selected &&
            action(
              () => window.dockerApi.unpauseContainer(hostId, selected),
              t('已恢复'),
              t('正在恢复…')
            )
          }
        >
          <PlayCircle size={13} /> {t('恢复')}
        </button>
        <button
          className="btn"
          disabled={!selected || !selActions?.canKill}
          title={t('强制终止')}
          onClick={() =>
            selected &&
            action(
              () => window.dockerApi.killContainer(hostId, selected),
              t('已强制终止'),
              t('正在强杀…')
            )
          }
        >
          <Skull size={13} /> {t('强制终止')}
        </button>
        <button
          className="btn"
          disabled={!selected || !selActions?.canLogs}
          onClick={() => {
            if (!selected) return;
            openLogs(selected, list.find((c) => c.id === selected)?.name || '');
          }}
        >
          <FileText size={13} /> {t('日志')}
        </button>
        <button
          className="btn"
          disabled={!selected || !selActions?.canExec}
          title={selected && !selActions?.canExec ? t('仅运行中的容器可打开终端') : t('打开终端')}
          onClick={() => {
            if (!selected) return;
            openTerminal(selected, list.find((c) => c.id === selected)?.name || '');
          }}
        >
          <TermIcon size={13} /> {t('终端')}
        </button>
        <button
          className="btn danger"
          disabled={!selected || !selActions?.canRemove}
          onClick={() => {
            if (!selected) return;
            void removeOne(selected, selectedContainer?.name || selected);
          }}
        >
          <Trash2 size={13} /> {t('删除')}
        </button>
        {checked.size > 0 && (
          <>
            <div style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 4px' }} />
            <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{t('已选')} {checked.size}</span>
            <button
              className="btn"
              onClick={() =>
                runOn(
                  [...checked],
                  (id) => window.dockerApi.startContainer(hostId, id),
                  t("已启动 {p0} 个", { p0: checked.size })
                )
              }
            >
              <Play size={13} /> {t('批量启动')}
            </button>
            <button
              className="btn"
              onClick={() =>
                runOn(
                  [...checked],
                  (id) => window.dockerApi.stopContainer(hostId, id),
                  t("已停止 {p0} 个", { p0: checked.size })
                )
              }
            >
              <Square size={13} /> {t('批量停止')}
            </button>
            <button
              className="btn danger"
              onClick={() => void removeMany([...checked])}
            >
              <Trash2 size={13} /> {t('批量删除')}
            </button>
            <button className="btn ghost" onClick={() => clearChecked()}>
              {t('清除选择')}
            </button>
          </>
        )}
        {(filter || stateFilter !== 'all') && (
          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            {filtered.length}/{list.length} {t('个容器')}
          </span>
        )}
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value as typeof stateFilter)}
            style={{ height: 28 }}
          >
            <option value="all">{t('全部状态')}</option>
            <option value="running">{t('运行中')}</option>
            <option value="exited">{t('已退出')}</option>
            <option value="paused">{t('已暂停')}</option>
            <option value="restarting">{t('重启中')}</option>
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
              style={{ paddingLeft: 26, paddingRight: filter ? 26 : undefined }}
              placeholder={t('过滤名称 / 镜像 / 项目（Ctrl+F）')}
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

      <div
        ref={scrollRef}
        style={{ flex: 1, overflow: 'auto', minHeight: 0 }}
        onScroll={windowed ? handleListScroll : undefined}
      >
        {loading && list.length === 0 && !error ? (
          <ListLoading label={t('正在加载容器…')} />
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <p>{list.length === 0 ? t('暂无容器') : t('没有匹配的容器')}</p>
            {list.length > 0 && (
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
                <th style={{ width: 28 }}>
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={toggleAll}
                    style={{ width: 12, height: 12 }}
                  />
                </th>
                <SortableTh label={t('名称')} active={sortKey === 'name'} asc={sortAsc} onSort={() => toggleSort('name')} />
                <SortableTh label={t('状态')} active={sortKey === 'state'} asc={sortAsc} onSort={() => toggleSort('state')} />
                <SortableTh label={t('镜像')} active={sortKey === 'image'} asc={sortAsc} onSort={() => toggleSort('image')} />
                <SortableTh label={t('项目')} active={sortKey === 'project'} asc={sortAsc} onSort={() => toggleSort('project')} />
                <th>{t('端口')}</th>
                <SortableTh label={t('创建时间')} active={sortKey === 'created'} asc={sortAsc} onSort={() => toggleSort('created')} />
                <th style={{ width: 140 }}>{t('操作')}</th>
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
                  title={t('双击打开详情')}
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
                      selectRange(
                        filtered.map((x) => x.id),
                        from,
                        to
                      );
                      setSelected(c.id);
                      return;
                    }
                    setSelected(c.id);
                  }}
                  onDoubleClick={() => openDetail(c.id, c.name)}
                  onContextMenu={(e) => {
                    setSelected(c.id);
                    if (!checked.has(c.id)) selectAll([c.id]);
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
                  <td
                    style={{ color: 'var(--text-muted)', fontSize: 11, whiteSpace: 'nowrap' }}
                    title={fmtAbsolute(c.created * 1000)}
                  >
                    {fmtTimeAgo(c.created * 1000)}
                  </td>
                  <td>
                    <ContainerRowActions
                      container={c}
                      onStart={() =>
                        void action(
                          () => window.dockerApi.startContainer(hostId, c.id),
                          t('已启动'),
                          t("{p0}: 正在启动…", { p0: c.name })
                        )
                      }
                      onStop={() =>
                        void action(
                          () => window.dockerApi.stopContainer(hostId, c.id),
                          t('已停止'),
                          t("{p0}: 正在停止…", { p0: c.name })
                        )
                      }
                      onRestart={() =>
                        void action(
                          () => window.dockerApi.restartContainer(hostId, c.id),
                          t('已重启'),
                          t("{p0}: 正在重启…", { p0: c.name })
                        )
                      }
                      onPause={() =>
                        void action(
                          () => window.dockerApi.pauseContainer(hostId, c.id),
                          t('已暂停'),
                          t("{p0}: 正在暂停…", { p0: c.name })
                        )
                      }
                      onUnpause={() =>
                        void action(
                          () => window.dockerApi.unpauseContainer(hostId, c.id),
                          t('已恢复'),
                          t("{p0}: 正在恢复…", { p0: c.name })
                        )
                      }
                      onKill={() =>
                        void action(
                          () => window.dockerApi.killContainer(hostId, c.id),
                          t('已强制终止'),
                          t("{p0}: 正在强杀…", { p0: c.name })
                        )
                      }
                      onStopRestartLoop={() => void stopRestartLoopOne(c.id, c.name)}
                      extra={
                        <>
                          <button
                            className="btn ghost icon-btn"
                            title={t('详情')}
                            onClick={(e) => {
                              e.stopPropagation();
                              openDetail(c.id, c.name);
                            }}
                          >
                            <Info size={12} />
                          </button>
                          <button
                            className="btn ghost icon-btn"
                            title={t('日志')}
                            onClick={(e) => {
                              e.stopPropagation();
                              openLogs(c.id, c.name);
                            }}
                          >
                            <FileText size={12} />
                          </button>
                          <button
                            className="btn ghost icon-btn danger-text"
                            title={t('删除')}
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
            toast(t('容器已创建'), 'success');
            await load();
            setSelected(id);
          }}
        />
      )}
      {renameFor && (
        <InputDialog
          title={t('重命名容器')}
          label={t('容器名称')}
          initial={renameFor.name}
          confirmLabel={t('重命名')}
          onClose={() => setRenameFor(null)}
          onSubmit={async (name) => {
            try {
              await window.dockerApi.renameContainer(hostId, renameFor.id, name);
              toast(t('已重命名'), 'success');
              setRenameFor(null);
              await load();
            } catch (e) {
              toast(e instanceof Error ? e.message : String(e), 'error');
            }
          }}
        />
      )}
      {confirmDialog}
      {ctx.menu && <ContextMenu state={ctx.menu} onClose={ctx.close} />}
    </div>
  );
}
