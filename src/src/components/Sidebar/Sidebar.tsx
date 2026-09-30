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
  Server,
  Layers,
  Box,
  Image as ImageIcon,
  Network,
  Database,
  Container,
  Terminal as TerminalIcon,
  FileText,
} from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { useConfirm } from '../../utils/useConfirm';
import type { ComposeProject, ContainerSummary, DockerConnectionConfig } from '../../types/docker';

interface Props {
  onAddConnection: () => void;
  onEditConnection: (cfg: DockerConnectionConfig) => void;
  onConnect: (id: string) => void;
  onDisconnect: (id: string) => void;
}

export function Sidebar({ onAddConnection, onEditConnection, onConnect, onDisconnect }: Props) {
  const {
    connections,
    statuses,
    expandedHosts,
    expandedCompose,
    selectedTreeKey,
    toggleHost,
    toggleCompose,
    selectTree,
    openTab,
    setContainers,
    containersByHost,
    containersVersion,
  } = useAppStore();

  const [hostProjects, setHostProjects] = useState<Record<string, ComposeProject[]>>({});
  const [hostLoose, setHostLoose] = useState<Record<string, ContainerSummary[]>>({});
  const [confirmDialog, confirm] = useConfirm();

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
      volumes: '卷',
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

  return (
    <div className="sidebar">
      <div className="sidebar-toolbar">
        <button className="btn ghost icon-btn" title="添加连接" onClick={onAddConnection}>
          <Plus size={15} />
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
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: 0.5 }}>DOCKER 资源管理</span>
      </div>

      <div className="sidebar-body">
        {connections.length === 0 && (
          <div className="empty-state" style={{ padding: '32px 16px' }}>
            <Server size={32} strokeWidth={1.2} color="var(--text-muted)" />
            <div style={{ fontSize: 12 }}>还没有 Docker 连接</div>
            <button className="btn primary" onClick={onAddConnection}>
              <Plus size={14} /> 添加连接
            </button>
          </div>
        )}

        {connections.map((conn) => {
          const st = statuses[conn.id];
          const isExpanded = !!expandedHosts[conn.id];
          const selected = selectedTreeKey === `host:${conn.id}`;
          const projects = hostProjects[conn.id] || [];
          const loose = hostLoose[conn.id] || [];

          return (
            <div key={conn.id}>
              <div
                className={`tree-row ${selected ? 'selected' : ''}`}
                style={{ paddingLeft: 6, fontWeight: 500 }}
                onClick={() => {
                  selectTree(`host:${conn.id}`, conn.id);
                  openTab({
                    id: `dashboard:${conn.id}`,
                    title: `仪表板 · ${conn.name}`,
                    kind: 'dashboard',
                    hostId: conn.id,
                  });
                }}
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
                          style={{ paddingLeft: 22 }}
                          onClick={() => {
                            selectTree(pKey, conn.id);
                            openTab({
                              id: `composeProject:${conn.id}:${p.name}`,
                              title: `Docker-compose: ${p.name}`,
                              kind: 'composeProject',
                              hostId: conn.id,
                              projectName: p.name,
                            });
                          }}
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
                          <span className="label">Docker-compose: {p.name}</span>
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
                                  style={{ paddingLeft: 48 }}
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
                        style={{ paddingLeft: 22 }}
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
                    style={{ paddingLeft: 22 }}
                    onClick={() => {
                      selectTree(`containers:${conn.id}`, conn.id);
                      openView(conn.id, 'containers');
                    }}
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
                    style={{ paddingLeft: 22 }}
                    onClick={() => {
                      selectTree(`images:${conn.id}`, conn.id);
                      openView(conn.id, 'images');
                    }}
                  >
                    <span className="twisty" />
                    <span className="icon">
                      <ImageIcon size={14} color="var(--image)" />
                    </span>
                    <span className="label">镜像</span>
                  </div>

                  <div
                    className={`tree-row ${selectedTreeKey === `networks:${conn.id}` ? 'selected' : ''}`}
                    style={{ paddingLeft: 22 }}
                    onClick={() => {
                      selectTree(`networks:${conn.id}`, conn.id);
                      openView(conn.id, 'networks');
                    }}
                  >
                    <span className="twisty" />
                    <span className="icon">
                      <Network size={14} color="var(--network)" />
                    </span>
                    <span className="label">网络</span>
                  </div>

                  <div
                    className={`tree-row ${selectedTreeKey === `volumes:${conn.id}` ? 'selected' : ''}`}
                    style={{ paddingLeft: 22 }}
                    onClick={() => {
                      selectTree(`volumes:${conn.id}`, conn.id);
                      openView(conn.id, 'volumes');
                    }}
                  >
                    <span className="twisty" />
                    <span className="icon">
                      <Database size={14} color="var(--volume)" />
                    </span>
                    <span className="label">卷</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* quick actions footer of sidebar */}
      <div
        style={{
          borderTop: '1px solid var(--border)',
          padding: '6px 8px',
          display: 'flex',
          gap: 4,
          flexShrink: 0,
          justifyContent: 'flex-end',
        }}
      >
        <span style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: '22px' }}>
          IDEA Docker 管理器
        </span>
      </div>
      {confirmDialog}
    </div>
  );
}
