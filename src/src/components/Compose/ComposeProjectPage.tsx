import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  RefreshCw,
  Play,
  Square,
  RotateCw,
  FileText,
  Terminal as TermIcon,
  Layers,
  Trash2,
  Copy,
  Skull,
  Info,
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  Download,
  Pause,
  PlayCircle,
} from 'lucide-react';
import type { ContainerSummary, ComposeProject } from '../../types/docker';
import { useAppStore } from '../../stores/appStore';
import { reportError } from '../../utils/connection';
import { runAction } from '../../utils/runAction';
import { useConfirm } from '../../utils/useConfirm';
import { useHotkeys } from '../../utils/useHotkeys';
import { loadUiPref, saveUiPref } from '../../utils/uiPrefs';
import { localizeStatusChip, localizeContainerStatus, statusChipExtraClass } from '../../utils/localize';
import { formatPortMappings } from '../../utils/ports';
import { getContainerActions, stopRestartLoop } from '../../utils/containerActions';
import { useMultiSelect } from '../../hooks/useMultiSelect';
import { ContainerRowActions } from '../Containers/ContainerRowActions';
import { ContextMenu, useContextMenu, type ContextMenuItem } from '../common/ContextMenu';
import { ListError, ListLoading } from '../common/ListFeedback';
import { SortableTh } from '../common/SortableTh';
import { usePolling } from '../../hooks/usePolling';

type SortKey = 'service' | 'name' | 'state' | 'image';

export function ComposeProjectPage({
  hostId,
  projectName,
  active = true,
}: {
  hostId: string;
  projectName: string;
  /** false while the tab is hidden (keep-alive) — polling pauses */
  active?: boolean;
}) {
  const toast = useAppStore((s) => s.toast);
  const setRefreshing = useAppStore((s) => s.setRefreshing);
  const openTab = useAppStore((s) => s.openTab);
  const containersVersion = useAppStore((s) => s.containersVersion);
  const [containers, setContainers] = useState<ContainerSummary[]>([]);
  const [project, setProject] = useState<ComposeProject | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  /** multi-select ids (checkbox). `selected` remains the focus row for toolbar actions. */
  const {
    checked,
    toggle: toggleChecked,
    selectAll,
    clear: clearChecked,
    selectRange,
  } = useMultiSelect();
  const [sortKey, setSortKey] = useState<SortKey>(() => loadUiPref('compose.sortKey', 'service'));
  const [sortAsc, setSortAsc] = useState(() => loadUiPref('compose.sortAsc', true));
  const [confirmDialog, confirm] = useConfirm();
  const ctx = useContextMenu();

  const load = useCallback(async () => {
    setLoading(true);
    setRefreshing(true);
    setError(null);
    try {
      const [projects, all] = await Promise.all([
        window.dockerApi.listComposeProjects(hostId),
        window.dockerApi.listContainers(hostId, true, true),
      ]);
      const p = projects.find((x) => x.name === projectName) || null;
      setProject(p);
      setContainers(all.filter((c) => c.composeProject === projectName));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [hostId, projectName, setRefreshing]);

  // fallback poll only — docker events drive most reloads; the hook skips
  // ticks while hidden and catches up on reactivation
  usePolling({ active, reloadKey: `${hostId}:${projectName}`, intervalMs: 30000, onLoad: load });

  useEffect(() => {
    if (containersVersion > 0) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containersVersion]);

  const action = async (fn: () => Promise<unknown>, msg: string, pendingMsg = '处理中…') => {
    await runAction(toast, { pending: pendingMsg, ok: msg }, fn);
    await load();
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

  const runCompose = async (
    fn: () => Promise<{ ok: boolean; output: string; exitCode: number | null }>,
    okMsg: string
  ) => {
    try {
      const res = await fn();
      if (res.ok) toast(okMsg, 'success');
      else {
        toast(`失败（退出码 ${res.exitCode ?? '-'}）`, 'error');
        console.error(res.output);
      }
      await load();
    } catch (e) {
      reportError(e, toast);
    }
  };

  const composeDown = async () => {
    const ok = await confirm({
      title: '下线 Compose 项目',
      message: `将执行 docker compose -p ${projectName} down，停止并移除该项目的容器。数据卷默认保留。`,
      confirmLabel: '下线',
      danger: true,
    });
    if (!ok) return;
    await runCompose(
      () => window.dockerApi.composeProjectDown(hostId, projectName, false),
      '项目已下线'
    );
  };

  const composePull = async () => {
    await runCompose(
      () => window.dockerApi.composeProjectPull(hostId, projectName),
      '镜像已更新，请重启项目以生效'
    );
  };

  const running = useMemo(() => containers.filter((c) => c.state === 'running').length, [containers]);

  const sorted = useMemo(() => {
    const dir = sortAsc ? 1 : -1;
    return [...containers].sort((a, b) => {
      switch (sortKey) {
        case 'service':
          return dir * (a.composeService || '').localeCompare(b.composeService || '');
        case 'name':
          return dir * a.name.localeCompare(b.name);
        case 'state':
          return dir * a.state.localeCompare(b.state);
        case 'image':
          return dir * a.image.localeCompare(b.image);
        default:
          return 0;
      }
    });
  }, [containers, sortKey, sortAsc]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  const allChecked = sorted.length > 0 && sorted.every((c) => checked.has(c.id));

  const runChecked = (fn: (id: string) => Promise<unknown>, okMsg: string, pendingMsg: string) =>
    action(
      async () => {
        for (const id of [...checked]) await fn(id);
      },
      okMsg,
      pendingMsg
    );

  useEffect(() => {
    saveUiPref('compose.sortKey', sortKey);
    saveUiPref('compose.sortAsc', sortAsc);
  }, [sortKey, sortAsc]);

  const sortInd = (key: SortKey) =>
    sortKey === key ? (
      <span className="sort-ind">{sortAsc ? <ArrowUp size={11} /> : <ArrowDown size={11} />}</span>
    ) : null;

  useHotkeys({
    f5: () => void load(),
    escape: () => {
      setSelected(null);
      clearChecked();
    },
    arrowdown: () => {
      if (sorted.length === 0) return;
      const idx = selected ? sorted.findIndex((c) => c.id === selected) : -1;
      const next = sorted[Math.min(idx + 1, sorted.length - 1)] ?? sorted[0];
      setSelected(next.id);
    },
    arrowup: () => {
      if (sorted.length === 0) return;
      const idx = selected ? sorted.findIndex((c) => c.id === selected) : sorted.length;
      const next = sorted[Math.max(idx - 1, 0)] ?? sorted[0];
      setSelected(next.id);
    },
    enter: () => {
      if (!selected) return;
      const c = sorted.find((x) => x.id === selected);
      if (!c) return;
      openTab({
        id: `containerDetail:${hostId}:${c.id}`,
        title: `容器: ${c.name}`,
        kind: 'containerDetail',
        hostId,
        containerId: c.id,
      });
    },
    delete: () => {
      if (!selected) return;
      const c = sorted.find((x) => x.id === selected);
      if (!c) return;
      void (async () => {
        const ok = await confirm({
          title: '删除容器',
          message: `确认删除容器「${c.name}」？数据卷将一并移除。`,
          confirmLabel: '删除',
          danger: true,
        });
        if (!ok) return;
        void action(() => window.dockerApi.removeContainer(hostId, c.id, true), '已删除');
      })();
    },
  });

  const rowMenu = (c: ContainerSummary): ContextMenuItem[] => {
    const a = getContainerActions(c.state, c.status);
    // operate on the whole checked set when the right-clicked row belongs to it
    const ids = checked.has(c.id) && checked.size > 1 ? [...checked] : [c.id];
    const each =
      (fn: (id: string) => Promise<unknown>) =>
      async () => {
        for (const id of ids) await fn(id);
      };
    const items: ContextMenuItem[] = [];
    if (a.canStart) {
      items.push({
        key: 'start',
        label: '启动',
        icon: <Play size={13} />,
        onSelect: () => void action(each((id) => window.dockerApi.startContainer(hostId, id)), '已启动'),
      });
    }
    if (a.canStop) {
      items.push({
        key: 'stop',
        label: '停止',
        icon: <Square size={13} />,
        onSelect: () => void action(each((id) => window.dockerApi.stopContainer(hostId, id)), '已停止'),
      });
    }
    if (a.canRestart) {
      items.push({
        key: 'restart',
        label: '重启',
        icon: <RotateCw size={13} />,
        onSelect: () => void action(each((id) => window.dockerApi.restartContainer(hostId, id)), '已重启'),
      });
    }
    if (a.canKill) {
      items.push({
        key: 'kill',
        label: '强制终止',
        icon: <Skull size={13} />,
        onSelect: () => void action(each((id) => window.dockerApi.killContainer(hostId, id)), '已强制终止'),
      });
    }
    if (a.canPause) {
      items.push({
        key: 'pause',
        label: '暂停',
        icon: <Pause size={13} />,
        onSelect: () => void action(() => window.dockerApi.pauseContainer(hostId, c.id), '已暂停'),
      });
    }
    if (a.canUnpause) {
      items.push({
        key: 'unpause',
        label: '恢复',
        icon: <PlayCircle size={13} />,
        onSelect: () => void action(() => window.dockerApi.unpauseContainer(hostId, c.id), '已恢复'),
      });
    }
    if (a.isRestartLoop) {
      items.push({
        key: 'loop',
        label: '停止重启循环',
        onSelect: () => void stopRestartLoopOne(c.id, c.name),
      });
    }
    items.push({ key: 'sep1', label: '', separator: true, onSelect: () => {} });
    items.push({
      key: 'logs',
      label: '查看日志',
      icon: <FileText size={13} />,
      onSelect: () =>
        openTab({
          id: `logs:${hostId}:${c.id}`,
          title: `日志 · ${c.name}`,
          kind: 'logs',
          hostId,
          containerId: c.id,
        }),
    });
    items.push({
      key: 'term',
      label: '打开终端',
      icon: <TermIcon size={13} />,
      disabled: !a.canExec,
      onSelect: () =>
        openTab({
          id: `terminal:${hostId}:${c.id}`,
          title: `终端 · ${c.name}`,
          kind: 'terminal',
          hostId,
          containerId: c.id,
        }),
    });
    items.push({
      key: 'detail',
      label: '打开详情',
      icon: <Info size={13} />,
      onSelect: () =>
        openTab({
          id: `containerDetail:${hostId}:${c.id}`,
          title: `容器: ${c.name}`,
          kind: 'containerDetail',
          hostId,
          containerId: c.id,
        }),
    });
    items.push({
      key: 'copy',
      label: '复制容器 ID',
      icon: <Copy size={13} />,
      onSelect: () => {
        void navigator.clipboard?.writeText(c.id);
        toast('已复制容器 ID', 'info');
      },
    });
    items.push({ key: 'sep2', label: '', separator: true, onSelect: () => {} });
    items.push({
      key: 'del',
      label: '删除…',
      icon: <Trash2 size={13} />,
      danger: true,
      disabled: !a.canRemove,
      onSelect: () => {
        void (async () => {
          const ok = await confirm({
            title: '删除容器',
            message: `确认删除容器「${c.name}」？数据卷将一并移除。`,
            confirmLabel: '删除',
            danger: true,
          });
          if (!ok) return;
          void action(() => window.dockerApi.removeContainer(hostId, c.id, true), '已删除');
        })();
      },
    });
    return items;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="content-toolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 8 }}>
          <button
            className="btn ghost icon-btn"
            title="返回项目列表"
            onClick={() => {
              const conn = useAppStore.getState().connections.find((c) => c.id === hostId);
              openTab({
                id: `compose:${hostId}`,
                title: `Docker Compose · ${conn?.name || hostId}`,
                kind: 'compose',
                hostId,
              });
            }}
          >
            <ArrowLeft size={14} />
          </button>
          <Layers size={18} color="var(--compose)" />
          <div>
            <div style={{ fontWeight: 600, color: 'var(--text-bright)' }}>{projectName}</div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
              {running}/{containers.length} 个容器运行中
              {project ? ` · ${project.services.length} 个服务` : ''}
            </div>
          </div>
        </div>
        <button className="btn" onClick={load} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'spinner' : ''} /> 刷新
        </button>
        <button
          className="btn"
          onClick={async () => {
            const ok = await confirm({
              title: '启动全部容器',
              message: '确认启动该项目的全部未运行容器？',
              confirmLabel: '启动',
            });
            if (!ok) return;
            await action(
              async () => {
                for (const c of containers) {
                  if (c.state !== 'running') await window.dockerApi.startContainer(hostId, c.id);
                }
              },
              '项目已启动',
              '正在启动全部…'
            );
          }}
        >
          <Play size={13} /> 启动全部
        </button>
        <button
          className="btn"
          onClick={async () => {
            const ok = await confirm({
              title: '停止全部容器',
              message: '确认停止该项目的全部运行中容器？',
              confirmLabel: '停止',
              danger: true,
            });
            if (!ok) return;
            await action(
              async () => {
                for (const c of containers) {
                  if (c.state === 'running') await window.dockerApi.stopContainer(hostId, c.id);
                }
              },
              '项目已停止',
              '正在停止全部…'
            );
          }}
        >
          <Square size={13} /> 停止全部
        </button>
        <button
          className="btn"
          onClick={async () => {
            const ok = await confirm({
              title: '重启全部容器',
              message: '确认重启该项目的全部容器？',
              confirmLabel: '重启',
            });
            if (!ok) return;
            await action(
              async () => {
                for (const c of containers) await window.dockerApi.restartContainer(hostId, c.id);
              },
              '项目已重启',
              '正在重启全部…'
            );
          }}
        >
          <RotateCw size={13} /> 重启全部
        </button>
        <button className="btn" onClick={() => void composePull()}>
          <Download size={13} /> 更新镜像
        </button>
        <button className="btn danger" onClick={() => void composeDown()}>
          <Trash2 size={13} /> 项目下线
        </button>
        <button
          className="btn"
          onClick={() =>
            openTab({
              id: `composeLogs:${hostId}:${projectName}`,
              title: `项目日志 · ${projectName}`,
              kind: 'composeLogs',
              hostId,
              projectName,
            })
          }
        >
          <FileText size={13} /> 项目日志
        </button>
        {checked.size > 0 && (
          <>
            <div style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 4px' }} />
            <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>已选 {checked.size}</span>
            <button
              className="btn"
              onClick={() =>
                void runChecked((id) => window.dockerApi.startContainer(hostId, id), '已启动', '正在启动所选…')
              }
            >
              <Play size={13} /> 启动
            </button>
            <button
              className="btn"
              onClick={() =>
                void runChecked((id) => window.dockerApi.stopContainer(hostId, id), '已停止', '正在停止所选…')
              }
            >
              <Square size={13} /> 停止
            </button>
            <button
              className="btn"
              onClick={() =>
                void runChecked((id) => window.dockerApi.restartContainer(hostId, id), '已重启', '正在重启所选…')
              }
            >
              <RotateCw size={13} /> 重启
            </button>
            <button className="btn ghost" onClick={() => clearChecked()}>
              清除选择
            </button>
          </>
        )}
        <div style={{ flex: 1 }} />
        {(() => {
          const cur = containers.find((c) => c.id === selected);
          const curActs = cur ? getContainerActions(cur.state, cur.status) : null;
          return (
            <>
              <button
                className="btn"
                disabled={!selected || !curActs?.canLogs}
                onClick={() => {
                  if (!selected || !cur) return;
                  openTab({
                    id: `logs:${hostId}:${selected}`,
                    title: `日志 · ${cur.name}`,
                    kind: 'logs',
                    hostId,
                    containerId: selected,
                  });
                }}
              >
                <FileText size={13} /> 日志
              </button>
              <button
                className="btn"
                disabled={!selected || !curActs?.canExec}
                title={selected && !curActs?.canExec ? '仅运行中的容器可打开终端' : '打开终端'}
                onClick={() => {
                  if (!selected || !cur) return;
                  openTab({
                    id: `terminal:${hostId}:${selected}`,
                    title: `终端 · ${cur.name}`,
                    kind: 'terminal',
                    hostId,
                    containerId: selected,
                  });
                }}
              >
                <TermIcon size={13} /> 终端
              </button>
            </>
          );
        })()}
      </div>

      {error && <ListError error={error} onRetry={() => void load()} />}

      <div style={{ flex: 1, overflow: 'auto' }}>
        {loading && containers.length === 0 && !error ? (
          <ListLoading label="正在加载项目服务…" />
        ) : containers.length === 0 ? (
          <div className="empty-state">
            <p>该项目下没有容器</p>
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
                      selectAll(allChecked ? [] : sorted.map((c) => c.id))
                    }
                    style={{ width: 12, height: 12 }}
                  />
                </th>
                <SortableTh label={'服务'} active={sortKey === 'service'} asc={sortAsc} onSort={() => toggleSort('service')} />
                <SortableTh label={'容器'} active={sortKey === 'name'} asc={sortAsc} onSort={() => toggleSort('name')} />
                <SortableTh label={'状态'} active={sortKey === 'state'} asc={sortAsc} onSort={() => toggleSort('state')} />
                <SortableTh label={'镜像'} active={sortKey === 'image'} asc={sortAsc} onSort={() => toggleSort('image')} />
                <th>端口</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((c) => (
                <tr
                  key={c.id}
                  title="双击打开详情"
                  className={`${selected === c.id ? 'selected' : ''} ${checked.has(c.id) ? 'checked' : ''}`}
                  onClick={(e) => {
                    // ctrl/cmd toggles multi-select; shift selects range; plain click focuses
                    if (e.ctrlKey || e.metaKey) {
                      toggleChecked(c.id);
                      setSelected(c.id);
                      return;
                    }
                    if (e.shiftKey && selected) {
                      const from = sorted.findIndex((x) => x.id === selected);
                      const to = sorted.findIndex((x) => x.id === c.id);
                      selectRange(
                        sorted.map((x) => x.id),
                        from,
                        to
                      );
                      setSelected(c.id);
                      return;
                    }
                    setSelected(c.id);
                  }}
                  onDoubleClick={() =>
                    openTab({
                      id: `containerDetail:${hostId}:${c.id}`,
                      title: `容器: ${c.name}`,
                      kind: 'containerDetail',
                      hostId,
                      containerId: c.id,
                    })
                  }
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
                  <td style={{ color: 'var(--compose)', fontWeight: 500 }}>{c.composeService || '-'}</td>
                  <td style={{ color: 'var(--text-bright)' }}>{c.name}</td>
                  <td>
                    <span className={`chip ${c.state} ${statusChipExtraClass(c.status, c.state)}`}>
                      <span className="dot" />
                      <span title={localizeContainerStatus(c.status)}>
                        {localizeStatusChip(c.status, c.state)}
                      </span>
                    </span>
                  </td>
                  <td className="mono" style={{ color: 'var(--text-dim)', fontSize: 11, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {c.image}
                  </td>
                  <td className="mono" style={{ fontSize: 11 }}>
                    {formatPortMappings(c.ports)}
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
                      onStopRestartLoop={() => void stopRestartLoopOne(c.id, c.name)}
                      extra={
                        <>
                          <button
                            className="btn ghost icon-btn"
                            title="详情"
                            onClick={(e) => {
                              e.stopPropagation();
                              openTab({
                                id: `containerDetail:${hostId}:${c.id}`,
                                title: `容器: ${c.name}`,
                                kind: 'containerDetail',
                                hostId,
                                containerId: c.id,
                              });
                            }}
                          >
                            <Info size={12} />
                          </button>
                          <button
                            className="btn ghost icon-btn"
                            title="日志"
                            onClick={(e) => {
                              e.stopPropagation();
                              openTab({
                                id: `logs:${hostId}:${c.id}`,
                                title: `日志 · ${c.name}`,
                                kind: 'logs',
                                hostId,
                                containerId: c.id,
                              });
                            }}
                          >
                            <FileText size={12} />
                          </button>
                        </>
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {confirmDialog}
      {ctx.menu && <ContextMenu state={ctx.menu} onClose={ctx.close} />}
    </div>
  );
}
