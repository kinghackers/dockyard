import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, Layers, Play, Square, ChevronRight, FolderUp } from 'lucide-react';
import type { ComposeProject } from '../../types/docker';
import { useAppStore } from '../../stores/appStore';
import { reportError } from '../../utils/connection';
import { runAction } from '../../utils/runAction';
import { localizeStatusChip, localizeContainerStatus, localizeContainerState } from '../../utils/localize';
import { ComposeUpDialog } from './ComposeUpDialog';

export function ComposeListPage({ hostId }: { hostId: string }) {
  const { toast, openTab, containersVersion } = useAppStore();
  const [projects, setProjects] = useState<ComposeProject[]>([]);
  const [loading, setLoading] = useState(false);
  const [upOpen, setUpOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await window.dockerApi.listComposeProjects(hostId);
      setProjects(data);
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

  const startProject = async (p: ComposeProject) => {
    await runAction(
      toast,
      {
        pending: `正在启动项目 ${p.name}…`,
        ok: `项目 ${p.name} 已启动`,
      },
      async () => {
        for (const c of p.containers) {
          if (c.state !== 'running') await window.dockerApi.startContainer(hostId, c.id);
        }
      }
    );
    await load();
  };

  const stopProject = async (p: ComposeProject) => {
    await runAction(
      toast,
      {
        pending: `正在停止项目 ${p.name}…`,
        ok: `项目 ${p.name} 已停止`,
      },
      async () => {
        for (const c of p.containers) {
          if (c.state === 'running') await window.dockerApi.stopContainer(hostId, c.id);
        }
      }
    );
    await load();
  };

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-title">
          <Layers size={18} color="var(--compose)" />
          Docker Compose 项目
        </div>
        <div style={{ flex: 1 }} />
        <button className="btn primary" onClick={() => setUpOpen(true)}>
          <FolderUp size={13} /> 从文件部署
        </button>
        <button className="btn" onClick={load} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'spinner' : ''} /> 刷新
        </button>
      </div>

      {projects.length === 0 ? (
        <div className="empty-state">
          <Layers size={32} strokeWidth={1.2} color="var(--text-muted)" />
          <h3>没有发现 Compose 项目</h3>
          <p>由 docker compose 启动的容器会按项目自动归类展示</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {projects.map((p) => (
            <div
              key={p.name}
              style={{
                background: 'var(--bg-panel)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  padding: '12px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <Layers size={18} color="var(--compose)" />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, color: 'var(--text-bright)', fontSize: 14 }}>{p.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                    {p.services.length} 个服务 · {p.running}/{p.total} 个容器运行中
                  </div>
                </div>
                <button className="btn" onClick={() => void startProject(p)}>
                  <Play size={13} /> 启动全部
                </button>
                <button className="btn" onClick={() => void stopProject(p)}>
                  <Square size={13} /> 停止全部
                </button>
                <button
                  className="btn primary"
                  onClick={() =>
                    openTab({
                      id: `composeProject:${hostId}:${p.name}`,
                      title: `Docker-compose: ${p.name}`,
                      kind: 'composeProject',
                      hostId,
                      projectName: p.name,
                    })
                  }
                >
                  打开 <ChevronRight size={13} />
                </button>
              </div>

              <table className="table">
                <thead>
                  <tr>
                    <th>服务</th>
                    <th>容器</th>
                    <th>镜像</th>
                    <th>状态</th>
                    <th>副本</th>
                  </tr>
                </thead>
                <tbody>
                  {p.services.map((s) => (
                    <tr
                      key={s.name}
                      style={{ cursor: 'pointer' }}
                      onClick={() => {
                        if (s.containerId) {
                          openTab({
                            id: `containerDetail:${hostId}:${s.containerId}`,
                            title: `容器: ${s.containerName || s.name}`,
                            kind: 'containerDetail',
                            hostId,
                            containerId: s.containerId,
                          });
                        }
                      }}
                    >
                      <td style={{ color: 'var(--compose)', fontWeight: 500 }}>{s.name}</td>
                      <td style={{ color: 'var(--text-bright)' }}>{s.containerName || '-'}</td>
                      <td className="mono" style={{ color: 'var(--text-dim)', fontSize: 11 }}>
                        {s.image || '-'}
                      </td>
                      <td>
                        <span className={`chip ${s.state || ''}`}>
                          <span className="dot" />
                          {s.state
                            ? localizeStatusChip(s.status || '', s.state)
                            : localizeContainerStatus(s.status || '') || '-'}
                        </span>
                      </td>
                      <td>{s.replicas || 1}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
      {upOpen && (
        <ComposeUpDialog
          hostId={hostId}
          onClose={() => setUpOpen(false)}
          onDeployed={async () => {
            await load();
          }}
          toast={toast}
        />
      )}
    </div>
  );
}
