import { useState, useEffect, useCallback } from 'react';
import {
  Plus,
  RefreshCw,
  Plug,
  PlugZap,
  Pencil,
  Trash2,
  ChevronRight,
  ChevronDown,
  ChevronsUpDown,
  Server,
  Layers,
  Box,
  Image as ImageIcon,
  Network,
  Database,
  Container,
  Folder,
  FolderPlus,
  FolderOpen,
  FolderInput,
  HardDriveDownload,
  LayoutDashboard,
  FileText,
  Terminal as TermIcon,
  Info,
  Play,
  Square,
  RotateCw,
  Skull,
  Copy,
  Download,
  ArrowRight,
  Pause,
  PlayCircle,
  Boxes,
  Settings,
} from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { useConfirm } from '../../utils/useConfirm';
import { getContainerActions } from '../../utils/containerActions';
import type { ComposeProject, ContainerSummary, DockerConnectionConfig } from '../../types/docker';
import { GroupNameDialog } from './GroupNameDialog';
import { ConnectionBackupDialog } from '../Connection/ConnectionBackupDialog';
import { ContextMenu, useContextMenu, type ContextMenuItem } from '../common/ContextMenu';

interface Props {
  onAddConnection: (groupId?: string) => void;
  onEditConnection: (cfg: DockerConnectionConfig) => void;
  onConnect: (id: string) => void;
  onDisconnect: (id: string) => void;
}

function newGroupId() {
  return `grp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Run a docker API call from a tree context menu with pending/success/error toasts. */
async function runSidebarAction(pending: string, ok: string, fn: () => Promise<unknown>) {
  const { toast } = useAppStore.getState();
  toast(pending, 'info');
  try {
    await fn();
    toast(ok, 'success');
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), 'error');
  }
}

export function Sidebar({ onAddConnection, onEditConnection, onConnect, onDisconnect }: Props) {
  // per-field selectors: any unrelated store change (toasts, other hosts'
  // containers) must not re-render the whole sidebar tree
  const connections = useAppStore((s) => s.connections);
  const groups = useAppStore((s) => s.groups);
  const statuses = useAppStore((s) => s.statuses);
  const expandedHosts = useAppStore((s) => s.expandedHosts);
  const expandedGroups = useAppStore((s) => s.expandedGroups);
  const expandedCompose = useAppStore((s) => s.expandedCompose);
  const selectedTreeKey = useAppStore((s) => s.selectedTreeKey);
  const toggleHost = useAppStore((s) => s.toggleHost);
  const toggleGroup = useAppStore((s) => s.toggleGroup);
  const toggleCompose = useAppStore((s) => s.toggleCompose);
  const selectTree = useAppStore((s) => s.selectTree);
  const openTab = useAppStore((s) => s.openTab);
  const setContainers = useAppStore((s) => s.setContainers);
  const containersByHost = useAppStore((s) => s.containersByHost);
  const containersVersion = useAppStore((s) => s.containersVersion);
  const toast = useAppStore((s) => s.toast);

  const [hostProjects, setHostProjects] = useState<Record<string, ComposeProject[]>>({});
  const [hostLoose, setHostLoose] = useState<Record<string, ContainerSummary[]>>({});
  const [confirmDialog, confirm] = useConfirm();
  const [groupDialog, setGroupDialog] = useState<
    { mode: 'create' } | { mode: 'rename'; id: string; name: string } | null
  >(null);
  const [backupOpen, setBackupOpen] = useState(false);
  /** group id or '__root__' highlighted as drop target */
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const ctx = useContextMenu();

  const refreshHostTree = useCallback(
    async (hostId: string) => {
      const st = statuses[hostId];
      if (!st?.connected) return;
      try {
        const [projects, loose, containers] = await Promise.all([
          window.dockerApi.listComposeProjects(hostId),
          window.dockerApi.listUnclassified(hostId),
          window.dockerApi.listContainers(hostId, true),
        ]);
        setHostProjects((m) => ({ ...m, [hostId]: projects }));
        setHostLoose((m) => ({ ...m, [hostId]: loose }));
        setContainers(hostId, containers);
      } catch (e) {
        console.error('refresh host tree', e);
      }
    },
    [statuses, setContainers]
  );

  // when a host connects, refresh its tree; when it drops, clear stale rows
  useEffect(() => {
    for (const c of connections) {
      if (statuses[c.id]?.connected) {
        void refreshHostTree(c.id);
      } else {
        setHostProjects((m) => {
          if (!(c.id in m)) return m;
          const next = { ...m };
          delete next[c.id];
          return next;
        });
        setHostLoose((m) => {
          if (!(c.id in m)) return m;
          const next = { ...m };
          delete next[c.id];
          return next;
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connections.map((c) => statuses[c.id]?.connected).join(',')]);

  // auto-refresh expanded host trees when docker events fire
  useEffect(() => {
    if (containersVersion <= 0) return;
    for (const c of connections) {
      if (statuses[c.id]?.connected && expandedHosts[c.id]) {
        void refreshHostTree(c.id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containersVersion]);

  const handleToggleHost = async (id: string) => {
    toggleHost(id);
    if (!expandedHosts[id]) {
      await refreshHostTree(id);
    }
  };

  const openView = (hostId: string, kind: 'containers' | 'images' | 'networks' | 'volumes' | 'compose' | 'dashboard') => {
    const titles: Record<string, string> = {
      containers: '容器',
      images: '镜像',
      networks: '网络',
      volumes: '数据卷',
      compose: 'Docker Compose',
      dashboard: '仪表板',
    };
    const conn = connections.find((c) => c.id === hostId);
    openTab({
      id: `${kind}:${hostId}`,
      title: `${titles[kind]} · ${conn?.name || hostId}`,
      kind: kind === 'compose' ? 'compose' : kind,
      hostId,
    });
  };

  const submitGroup = async (name: string) => {
    if (!groupDialog) return;
    try {
      if (groupDialog.mode === 'create') {
        const g = await window.dockerApi.upsertGroup({ id: newGroupId(), name });
        useAppStore.getState().upsertGroupLocal(g);
        useAppStore.getState().toggleGroup(g.id); // expand so user can drop connections in
      } else {
        const g = await window.dockerApi.upsertGroup({ id: groupDialog.id, name });
        useAppStore.getState().upsertGroupLocal(g);
      }
      setGroupDialog(null);
    } catch (e) {
      useAppStore.getState().toast(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  const removeGroup = async (id: string, name: string) => {
    const ok = await confirm({
      title: '删除目录',
      message: `确认删除目录「${name}」？目录下的连接会回到根目录，连接本身不会被删除。`,
      confirmLabel: '删除',
      danger: true,
    });
    if (!ok) return;
    try {
      await window.dockerApi.removeGroup(id);
      useAppStore.getState().removeGroupLocal(id);
    } catch (err) {
      useAppStore.getState().toast(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  const moveToGroup = async (c: DockerConnectionConfig, groupId: string | undefined) => {
    if (c.groupId === groupId) return;
    try {
      const next = { ...c, groupId };
      if (!groupId) delete (next as { groupId?: string }).groupId;
      await window.dockerApi.upsertConnection(next);
      useAppStore.getState().upsertConnection(next);
      useAppStore.getState().toast(
        groupId
          ? `已移动到「${groups.find((g) => g.id === groupId)?.name || groupId}」`
          : '已移到根目录',
        'success'
      );
    } catch (err) {
      useAppStore.getState().toast(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  const dropTargetClass = (id: string) =>
    dragOverId === id ? { outline: '1px dashed var(--accent)', outlineOffset: -1 } : undefined;

  /** One Docker host node + its expanded resource tree. */
  const renderHost = (conn: DockerConnectionConfig, indent: number) => {
    const st = statuses[conn.id];
    const isExpanded = !!expandedHosts[conn.id];
    const selected = selectedTreeKey === `host:${conn.id}`;
    const projects = hostProjects[conn.id] || [];
    const loose = hostLoose[conn.id] || [];

    const deleteConnection = async () => {
      const ok = await confirm({
        title: '删除连接',
        message: `确认删除连接「${conn.name}」？仅移除配置，不影响远程 Docker 资源。`,
        confirmLabel: '删除',
        danger: true,
      });
      if (!ok) return;
      try {
        await window.dockerApi.removeConnection(conn.id);
        useAppStore.getState().removeConnectionLocal(conn.id);
      } catch (err) {
        useAppStore.getState().toast(
          err instanceof Error ? err.message : String(err),
          'error'
        );
      }
    };

    const composeProjectMenu = (p: ComposeProject): ContextMenuItem[] => [
      {
        key: 'open',
        label: '打开项目',
        icon: <Layers size={13} />,
        onSelect: () => {
          selectTree(`compose:${conn.id}:${p.name}`, conn.id);
          openTab({
            id: `composeProject:${conn.id}:${p.name}`,
            title: p.name,
            kind: 'composeProject',
            hostId: conn.id,
            projectName: p.name,
          });
        },
      },
      {
        key: 'logs',
        label: '项目日志',
        icon: <FileText size={13} />,
        onSelect: () =>
          openTab({
            id: `composeLogs:${conn.id}:${p.name}`,
            title: `项目日志 · ${p.name}`,
            kind: 'composeLogs',
            hostId: conn.id,
            projectName: p.name,
          }),
      },
      { key: 'sep1', label: '', separator: true, onSelect: () => {} },
      {
        key: 'start',
        label: '启动全部',
        icon: <Play size={13} />,
        onSelect: () =>
          void runSidebarAction(`正在启动项目 ${p.name}…`, `项目 ${p.name} 已启动`, async () => {
            for (const c of p.containers) {
              if (c.state !== 'running') await window.dockerApi.startContainer(conn.id, c.id);
            }
          }),
      },
      {
        key: 'stop',
        label: '停止全部',
        icon: <Square size={13} />,
        onSelect: () =>
          void runSidebarAction(`正在停止项目 ${p.name}…`, `项目 ${p.name} 已停止`, async () => {
            for (const c of p.containers) {
              if (c.state === 'running') await window.dockerApi.stopContainer(conn.id, c.id);
            }
          }),
      },
      {
        key: 'restart',
        label: '重启全部',
        icon: <RotateCw size={13} />,
        onSelect: () =>
          void runSidebarAction(`正在重启项目 ${p.name}…`, `项目 ${p.name} 已重启`, async () => {
            for (const c of p.containers) await window.dockerApi.restartContainer(conn.id, c.id);
          }),
      },
      {
        key: 'pull',
        label: '更新镜像',
        icon: <Download size={13} />,
        onSelect: () =>
          void runSidebarAction(`正在更新 ${p.name} 镜像…`, '镜像已更新', async () => {
            const res = await window.dockerApi.composeProjectPull(conn.id, p.name);
            if (!res.ok) throw new Error(res.output || `更新失败（退出码 ${res.exitCode ?? '-'}）`);
          }),
      },
      { key: 'sep2', label: '', separator: true, onSelect: () => {} },
      {
        key: 'down',
        label: '项目下线…',
        icon: <Trash2 size={13} />,
        danger: true,
        onSelect: () =>
          void (async () => {
            const ok = await confirm({
              title: '项目下线',
              message: `确认停止并移除项目「${p.name}」的容器？（默认保留数据卷）`,
              confirmLabel: '下线',
              danger: true,
            });
            if (!ok) return;
            await runSidebarAction(
              `正在下线项目 ${p.name}…`,
              `项目 ${p.name} 已下线`,
              () => window.dockerApi.composeProjectDown(conn.id, p.name)
            );
          })(),
      },
    ];

    const containerNodeMenu = (
      id: string,
      name: string,
      state?: string,
      status?: string
    ): ContextMenuItem[] => {
      const a = getContainerActions(state || 'created', status);
      const items: ContextMenuItem[] = [
        {
          key: 'detail',
          label: '打开详情',
          icon: <Info size={13} />,
          onSelect: () =>
            openTab({
              id: `containerDetail:${conn.id}:${id}`,
              title: `容器: ${name}`,
              kind: 'containerDetail',
              hostId: conn.id,
              containerId: id,
            }),
        },
        {
          key: 'logs',
          label: '查看日志',
          icon: <FileText size={13} />,
          onSelect: () =>
            openTab({
              id: `logs:${conn.id}:${id}`,
              title: `日志 · ${name}`,
              kind: 'logs',
              hostId: conn.id,
              containerId: id,
            }),
        },
        {
          key: 'term',
          label: '打开终端',
          icon: <TermIcon size={13} />,
          disabled: !a.canExec,
          onSelect: () =>
            openTab({
              id: `terminal:${conn.id}:${id}`,
              title: `终端 · ${name}`,
              kind: 'terminal',
              hostId: conn.id,
              containerId: id,
            }),
        },
      ];
      if (a.canStart || a.canStop || a.canRestart || a.canKill) {
        items.push({ key: 'sep', label: '', separator: true, onSelect: () => {} });
        if (a.canStart) {
          items.push({
            key: 'start',
            label: '启动',
            icon: <Play size={13} />,
            onSelect: () =>
              void runSidebarAction(
                `正在启动 ${name}…`,
                `已启动 ${name}`,
                () => window.dockerApi.startContainer(conn.id, id)
              ),
          });
        }
        if (a.canStop) {
          items.push({
            key: 'stop',
            label: '停止',
            icon: <Square size={13} />,
            onSelect: () =>
              void runSidebarAction(
                `正在停止 ${name}…`,
                `已停止 ${name}`,
                () => window.dockerApi.stopContainer(conn.id, id)
              ),
          });
        }
        if (a.canRestart) {
          items.push({
            key: 'restart',
            label: '重启',
            icon: <RotateCw size={13} />,
            onSelect: () =>
              void runSidebarAction(
                `正在重启 ${name}…`,
                `已重启 ${name}`,
                () => window.dockerApi.restartContainer(conn.id, id)
              ),
          });
        }
        if (a.canKill) {
          items.push({
            key: 'kill',
            label: '强制终止',
            icon: <Skull size={13} />,
            onSelect: () =>
              void runSidebarAction(
                `正在强制终止 ${name}…`,
                `已强制终止 ${name}`,
                () => window.dockerApi.killContainer(conn.id, id)
              ),
          });
        }
        if (a.canPause) {
          items.push({
            key: 'pause',
            label: '暂停',
            icon: <Pause size={13} />,
            onSelect: () =>
              void runSidebarAction(
                `正在暂停 ${name}…`,
                `已暂停 ${name}`,
                () => window.dockerApi.pauseContainer(conn.id, id)
              ),
          });
        }
        if (a.canUnpause) {
          items.push({
            key: 'unpause',
            label: '恢复',
            icon: <PlayCircle size={13} />,
            onSelect: () =>
              void runSidebarAction(
                `正在恢复 ${name}…`,
                `已恢复 ${name}`,
                () => window.dockerApi.unpauseContainer(conn.id, id)
              ),
          });
        }
      }
      items.push({ key: 'sep2', label: '', separator: true, onSelect: () => {} });
      items.push({
        key: 'copy',
        label: '复制容器 ID',
        icon: <Copy size={13} />,
        onSelect: () => {
          void navigator.clipboard?.writeText(id);
          useAppStore.getState().toast('已复制容器 ID', 'info');
        },
      });
      if (a.canRemove) {
        items.push({
          key: 'del',
          label: '删除…',
          icon: <Trash2 size={13} />,
          danger: true,
          onSelect: () =>
            void (async () => {
              const ok = await confirm({
                title: '删除容器',
                message: `确认删除容器「${name}」？数据卷将一并移除。`,
                confirmLabel: '删除',
                danger: true,
              });
              if (!ok) return;
              await runSidebarAction(`正在删除 ${name}…`, '已删除', () =>
                window.dockerApi.removeContainer(conn.id, id, true)
              );
            })(),
        });
      }
      return items;
    };

    const categoryMenu = (
      treeKey: string,
      kind: 'containers' | 'images' | 'networks' | 'volumes',
      label: string
    ): ContextMenuItem[] => [
      {
        key: 'open',
        label: `打开${label}`,
        icon: <ArrowRight size={13} />,
        onSelect: () => {
          selectTree(treeKey, conn.id);
          openView(conn.id, kind);
        },
      },
    ];

    const hostMenu = (): ContextMenuItem[] => {
      const items: ContextMenuItem[] = [
        {
          key: 'toggle',
          label: isExpanded ? '折叠' : '展开',
          icon: <ChevronsUpDown size={13} />,
          onSelect: () => void handleToggleHost(conn.id),
        },
        {
          key: 'conn',
          label: st?.connected ? '断开连接' : '连接',
          icon: st?.connected ? <PlugZap size={13} /> : <Plug size={13} />,
          onSelect: () => {
            if (st?.connected) void onDisconnect(conn.id);
            else void onConnect(conn.id);
          },
        },
        { key: 'sep1', label: '', separator: true, onSelect: () => {} },
        {
          key: 'dashboard',
          label: '打开仪表板',
          icon: <LayoutDashboard size={13} />,
          onSelect: () => {
            selectTree(`host:${conn.id}`, conn.id);
            openTab({
              id: `dashboard:${conn.id}`,
              title: `仪表板 · ${conn.name}`,
              kind: 'dashboard',
              hostId: conn.id,
            });
          },
        },
        {
          key: 'containers',
          label: '打开容器列表',
          icon: <Box size={13} />,
          onSelect: () => openView(conn.id, 'containers'),
        },
        ...(conn.kind === 'ssh' && st?.connected
          ? [
              {
                key: 'hostterm' as const,
                label: '打开主机终端',
                icon: <TermIcon size={13} />,
                onSelect: () =>
                  openTab({
                    id: `hostterm:${conn.id}`,
                    title: `主机终端 · ${conn.name}`,
                    kind: 'terminal' as const,
                    hostId: conn.id,
                  }),
              },
            ]
          : []),
        { key: 'sep2', label: '', separator: true, onSelect: () => {} },
        {
          key: 'move',
          label: '移动到目录',
          icon: <FolderInput size={13} />,
          disabled: groups.length === 0,
          onSelect: () => {},
          children: [
            {
              key: 'move-root',
              label: '根目录',
              disabled: !conn.groupId,
              onSelect: () => void moveToGroup(conn, undefined),
            },
            ...groups.map((g) => ({
              key: `move-${g.id}`,
              label: g.name,
              disabled: conn.groupId === g.id,
              onSelect: () => void moveToGroup(conn, g.id),
            })),
          ],
        },
        {
          key: 'edit',
          label: '编辑连接…',
          icon: <Pencil size={13} />,
          onSelect: () => onEditConnection(conn),
        },
        {
          key: 'del',
          label: '删除连接…',
          icon: <Trash2 size={13} />,
          danger: true,
          onSelect: () => void deleteConnection(),
        },
      ];
      return items;
    };

    return (
      <div key={conn.id}>
        <div
          className={`tree-row ${selected ? 'selected' : ''}`}
          style={{ paddingLeft: indent, fontWeight: 500 }}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('application/x-docker-conn', conn.id);
            e.dataTransfer.effectAllowed = 'move';
          }}
          onClick={() => {
            selectTree(`host:${conn.id}`, conn.id);
            openTab({
              id: `dashboard:${conn.id}`,
              title: `仪表板 · ${conn.name}`,
              kind: 'dashboard',
              hostId: conn.id,
            });
          }}
          onContextMenu={(e) => ctx.open(e, hostMenu())}
        >
          <span
            className="twisty"
            onClick={(e) => {
              e.stopPropagation();
              void handleToggleHost(conn.id);
            }}
          >
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
          <span className="icon">
            <Server size={15} color="var(--host)" />
          </span>
          <span className="label">{conn.name}</span>
          <span
            className={`host-status-dot ${st?.connected ? 'online' : 'offline'}`}
            title={st?.connected ? '已连接' : st?.error || '未连接'}
          />
          <button
            className="btn ghost icon-btn"
            style={{ width: 22, height: 22 }}
            title={st?.connected ? '断开' : '连接'}
            onClick={(e) => {
              e.stopPropagation();
              if (st?.connected) void onDisconnect(conn.id);
              else void onConnect(conn.id);
            }}
          >
            {st?.connected ? <PlugZap size={13} color="var(--success)" /> : <Plug size={13} />}
          </button>
          <button
            className="btn ghost icon-btn"
            style={{ width: 22, height: 22 }}
            title="编辑"
            onClick={(e) => {
              e.stopPropagation();
              onEditConnection(conn);
            }}
          >
            <Pencil size={12} />
          </button>
          <button
            className="btn ghost icon-btn"
            style={{ width: 22, height: 22 }}
            title="删除"
            onClick={async (e) => {
              e.stopPropagation();
              await deleteConnection();
            }}
          >
            <Trash2 size={12} color="var(--error)" />
          </button>
        </div>

        {isExpanded && (
          <div>
            {projects.map((p) => {
              const pKey = `compose:${conn.id}:${p.name}`;
              const pExpanded = !!expandedCompose[pKey];
              return (
                <div key={pKey}>
                  <div
                    className={`tree-row ${selectedTreeKey === pKey ? 'selected' : ''}`}
                    style={{ paddingLeft: indent + 16 }}
                    onClick={() => {
                      selectTree(pKey, conn.id);
                      openTab({
                        id: `composeProject:${conn.id}:${p.name}`,
                        title: p.name,
                        kind: 'composeProject',
                        hostId: conn.id,
                        projectName: p.name,
                      });
                    }}
                    onContextMenu={(e) => ctx.open(e, composeProjectMenu(p))}
                  >
                    <span
                      className="twisty"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleCompose(pKey);
                      }}
                    >
                      {pExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    </span>
                    <span className="icon">
                      <Layers size={14} color="var(--compose)" />
                    </span>
                    <span className="label">{p.name}</span>
                    <span className="badge">
                      {p.running}/{p.total}
                    </span>
                  </div>
                  {pExpanded && (
                    <div>
                      {p.services.map((s) => {
                        const sKey = `svc:${conn.id}:${p.name}:${s.name}`;
                        return (
                          <div
                            key={sKey}
                            className={`tree-row ${selectedTreeKey === sKey ? 'selected' : ''}`}
                            style={{ paddingLeft: indent + 42 }}
                            onClick={() => {
                              selectTree(sKey, conn.id);
                              if (s.containerId) {
                                openTab({
                                  id: `containerDetail:${conn.id}:${s.containerId}`,
                                  title: `容器: ${s.containerName || s.name}`,
                                  kind: 'containerDetail',
                                  hostId: conn.id,
                                  containerId: s.containerId,
                                });
                              }
                            }}
                            onContextMenu={
                              s.containerId
                                ? (e) =>
                                    ctx.open(
                                      e,
                                      containerNodeMenu(
                                        s.containerId!,
                                        s.containerName || s.name,
                                        s.state,
                                        s.status
                                      )
                                    )
                                : undefined
                            }
                          >
                            <span className="twisty" />
                            <span className="icon">
                              <Container size={13} color="var(--container)" />
                            </span>
                            <span className="label">
                              {s.name}
                              {s.replicas && s.replicas > 1 ? ` (×${s.replicas})` : ''}
                            </span>
                            <span
                              className={`chip ${s.state || ''}`}
                              style={{ marginRight: 6 }}
                            >
                              <span className="dot" />
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {loose.map((c) => {
              const cKey = `c:${conn.id}:${c.id}`;
              return (
                <div
                  key={cKey}
                  className={`tree-row ${selectedTreeKey === cKey ? 'selected' : ''}`}
                  style={{ paddingLeft: indent + 16 }}
                  onClick={() => {
                    selectTree(cKey, conn.id);
                    openTab({
                      id: `containerDetail:${conn.id}:${c.id}`,
                      title: `容器: ${c.name}`,
                      kind: 'containerDetail',
                      hostId: conn.id,
                      containerId: c.id,
                    });
                  }}
                  onContextMenu={(e) => ctx.open(e, containerNodeMenu(c.id, c.name, c.state, c.status))}
                >
                  <span className="twisty" />
                  <span className="icon">
                    <Container size={13} color="var(--container)" />
                  </span>
                  <span className="label">{c.name}</span>
                  <span className={`chip ${c.state}`} style={{ marginRight: 6 }}>
                    <span className="dot" />
                  </span>
                </div>
              );
            })}

            <div
              className={`tree-row ${selectedTreeKey === `containers:${conn.id}` ? 'selected' : ''}`}
              style={{ paddingLeft: indent + 16 }}
              onClick={() => {
                selectTree(`containers:${conn.id}`, conn.id);
                openView(conn.id, 'containers');
              }}
              onContextMenu={(e) =>
                ctx.open(e, categoryMenu(`containers:${conn.id}`, 'containers', '容器列表'))
              }
            >
              <span className="twisty" />
              <span className="icon">
                <Box size={14} color="var(--container)" />
              </span>
              <span className="label">容器</span>
              <span className="badge">{containersByHost[conn.id]?.length ?? 0}</span>
            </div>

            <div
              className={`tree-row ${selectedTreeKey === `images:${conn.id}` ? 'selected' : ''}`}
              style={{ paddingLeft: indent + 16 }}
              onClick={() => {
                selectTree(`images:${conn.id}`, conn.id);
                openView(conn.id, 'images');
              }}
              onContextMenu={(e) =>
                ctx.open(e, categoryMenu(`images:${conn.id}`, 'images', '镜像列表'))
              }
            >
              <span className="twisty" />
              <span className="icon">
                <ImageIcon size={14} color="var(--image)" />
              </span>
              <span className="label">镜像</span>
            </div>

            <div
              className={`tree-row ${selectedTreeKey === `networks:${conn.id}` ? 'selected' : ''}`}
              style={{ paddingLeft: indent + 16 }}
              onClick={() => {
                selectTree(`networks:${conn.id}`, conn.id);
                openView(conn.id, 'networks');
              }}
              onContextMenu={(e) =>
                ctx.open(e, categoryMenu(`networks:${conn.id}`, 'networks', '网络列表'))
              }
            >
              <span className="twisty" />
              <span className="icon">
                <Network size={14} color="var(--network)" />
              </span>
              <span className="label">网络</span>
            </div>

            <div
              className={`tree-row ${selectedTreeKey === `volumes:${conn.id}` ? 'selected' : ''}`}
              style={{ paddingLeft: indent + 16 }}
              onClick={() => {
                selectTree(`volumes:${conn.id}`, conn.id);
                openView(conn.id, 'volumes');
              }}
              onContextMenu={(e) =>
                ctx.open(e, categoryMenu(`volumes:${conn.id}`, 'volumes', '数据卷列表'))
              }
            >
              <span className="twisty" />
              <span className="icon">
                <Database size={14} color="var(--volume)" />
              </span>
              <span className="label">数据卷</span>
            </div>
          </div>
        )}
      </div>
    );
  };

  const rootConnections = connections.filter((c) => !c.groupId);
  const grouped = groups.map((g) => ({
    group: g,
    items: connections.filter((c) => c.groupId === g.id),
  }));

  return (
    <div className="sidebar">
      <div className="sidebar-toolbar">
        <button className="btn ghost icon-btn" title="添加连接" onClick={() => onAddConnection()}>
          <Plus size={15} />
        </button>
        <button
          className="btn ghost icon-btn"
          title="新建目录"
          onClick={() => setGroupDialog({ mode: 'create' })}
        >
          <FolderPlus size={15} />
        </button>
        <button
          className="btn ghost icon-btn"
          title="刷新"
          onClick={() => {
            for (const c of connections) {
              if (statuses[c.id]?.connected) void refreshHostTree(c.id);
            }
          }}
        >
          <RefreshCw size={14} />
        </button>
        <button
          className="btn ghost icon-btn"
          title="导入 / 导出连接配置"
          onClick={() => setBackupOpen(true)}
        >
          <HardDriveDownload size={14} />
        </button>
        <div style={{ flex: 1 }} />
        <button
          className="btn ghost icon-btn"
          title="所有主机的容器（聚合视图）"
          onClick={() => {
            selectTree(null, null);
            openTab({ id: 'aggregateContainers', title: '所有容器', kind: 'aggregateContainers' });
          }}
        >
          <Boxes size={15} />
        </button>
        <button
          className="btn ghost icon-btn"
          title="设置"
          onClick={() => {
            selectTree(null, null);
            openTab({ id: 'settings', title: '设置', kind: 'settings' });
          }}
        >
          <Settings size={15} />
        </button>
      </div>

      <div
        className="sidebar-body"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('application/x-docker-conn')) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            setDragOverId('__root__');
          }
        }}
        onDragLeave={() => setDragOverId((v) => (v === '__root__' ? null : v))}
        onDrop={(e) => {
          e.preventDefault();
          setDragOverId(null);
          const id = e.dataTransfer.getData('application/x-docker-conn');
          const c = connections.find((x) => x.id === id);
          if (c) void moveToGroup(c, undefined);
        }}
      >
        {connections.length === 0 && groups.length === 0 && (
          <div className="empty-state" style={{ padding: '32px 16px' }}>
            <Server size={32} strokeWidth={1.2} color="var(--text-muted)" />
            <div style={{ fontSize: 12 }}>还没有 Docker 连接</div>
            <button className="btn primary" onClick={() => onAddConnection()}>
              <Plus size={14} /> 添加连接
            </button>
          </div>
        )}

        {rootConnections.map((conn) => renderHost(conn, 6))}

        {grouped.map(({ group, items }) => {
          const gKey = `group:${group.id}`;
          const gExpanded = !!expandedGroups[group.id];
          const groupMenu = (): ContextMenuItem[] => [
            {
              key: 'toggle',
              label: gExpanded ? '折叠' : '展开',
              onSelect: () => toggleGroup(group.id),
            },
            {
              key: 'add',
              label: '在此目录添加连接',
              icon: <Plus size={13} />,
              onSelect: () => onAddConnection(group.id),
            },
            { key: 'sep', label: '', separator: true, onSelect: () => {} },
            {
              key: 'rename',
              label: '重命名目录…',
              icon: <Pencil size={13} />,
              onSelect: () => setGroupDialog({ mode: 'rename', id: group.id, name: group.name }),
            },
            {
              key: 'del',
              label: '删除目录…',
              icon: <Trash2 size={13} />,
              danger: true,
              onSelect: () => void removeGroup(group.id, group.name),
            },
          ];
          return (
            <div key={group.id}>
              <div
                className={`tree-row ${selectedTreeKey === gKey ? 'selected' : ''}`}
                style={{ paddingLeft: 6, fontWeight: 500, marginTop: 4, ...dropTargetClass(group.id) }}
                onClick={() => toggleGroup(group.id)}
                onContextMenu={(e) => ctx.open(e, groupMenu())}
                onDragOver={(e) => {
                  if (e.dataTransfer.types.includes('application/x-docker-conn')) {
                    e.preventDefault();
                    e.stopPropagation();
                    e.dataTransfer.dropEffect = 'move';
                    setDragOverId(group.id);
                  }
                }}
                onDragLeave={() => setDragOverId((v) => (v === group.id ? null : v))}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDragOverId(null);
                  const id = e.dataTransfer.getData('application/x-docker-conn');
                  const c = connections.find((x) => x.id === id);
                  if (c) void moveToGroup(c, group.id);
                }}
              >
                <span
                  className="twisty"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleGroup(group.id);
                  }}
                >
                  {gExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </span>
                <span className="icon">
                  {gExpanded ? (
                    <FolderOpen size={15} color="var(--warning)" />
                  ) : (
                    <Folder size={15} color="var(--warning)" />
                  )}
                </span>
                <span className="label">{group.name}</span>
                <span className="badge">{items.length}</span>
                <button
                  className="btn ghost icon-btn"
                  style={{ width: 22, height: 22 }}
                  title="重命名"
                  onClick={(e) => {
                    e.stopPropagation();
                    setGroupDialog({ mode: 'rename', id: group.id, name: group.name });
                  }}
                >
                  <Pencil size={12} />
                </button>
                <button
                  className="btn ghost icon-btn"
                  style={{ width: 22, height: 22 }}
                  title="删除目录"
                  onClick={(e) => {
                    e.stopPropagation();
                    void removeGroup(group.id, group.name);
                  }}
                >
                  <Trash2 size={12} color="var(--error)" />
                </button>
              </div>
              {gExpanded && items.map((conn) => renderHost(conn, 22))}
              {gExpanded && items.length === 0 && (
                <div style={{ padding: '4px 0 4px 38px', fontSize: 11, color: 'var(--text-muted)' }}>
                  空目录 · 编辑连接可移入
                </div>
              )}
            </div>
          );
        })}
      </div>

      {confirmDialog}
      {groupDialog && (
        <GroupNameDialog
          title={groupDialog.mode === 'create' ? '新建目录' : '重命名目录'}
          initialName={groupDialog.mode === 'rename' ? groupDialog.name : ''}
          onClose={() => setGroupDialog(null)}
          onSubmit={submitGroup}
        />
      )}
      {backupOpen && (
        <ConnectionBackupDialog
          connections={connections}
          groups={groups}
          onClose={() => setBackupOpen(false)}
          onImported={async () => {
            // refresh connection list from disk after import
            try {
              const list = await window.dockerApi.listConnections();
              useAppStore.getState().setConnections(list);
              const g = await window.dockerApi.listGroups();
              useAppStore.getState().setGroups(g);
            } catch (err) {
              useAppStore.getState().toast(
                err instanceof Error ? err.message : String(err),
                'error'
              );
            }
          }}
          toast={toast}
        />
      )}
      {ctx.menu && <ContextMenu state={ctx.menu} onClose={ctx.close} />}
    </div>
  );
}
