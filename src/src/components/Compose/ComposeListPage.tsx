import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, Layers, Play, Square, ChevronRight, FolderUp } from 'lucide-react';
import type { ComposeProject } from '../../types/docker';
import { useAppStore } from '../../stores/appStore';
import { reportError } from '../../utils/connection';
import { runAction } from '../../utils/runAction';
import { localizeStatusChip, localizeContainerStatus, localizeContainerState } from '../../utils/localize';
import { ComposeUpDialog } from './ComposeUpDialog';
import { useConfirm } from '../../utils/useConfirm';
import { ListError, ListLoading } from '../common/ListFeedback';
import { t, useT } from '../../i18n';

export function ComposeListPage({ hostId }: { hostId: string }) {
  const t = useT();
  const toast = useAppStore((s) => s.toast);
  const setRefreshing = useAppStore((s) => s.setRefreshing);
  const openTab = useAppStore((s) => s.openTab);
  const containersVersion = useAppStore((s) => s.containersVersion);
  const [projects, setProjects] = useState<ComposeProject[]>([]);
  const [loading, setLoading] = useState(false);
  const [upOpen, setUpOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setRefreshing(true);
    setError(null);
    try {
      const data = await window.dockerApi.listComposeProjects(hostId);
      setProjects(data);
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
    if (containersVersion > 0) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containersVersion]);

  const [confirmDialog, confirm] = useConfirm();

  const startProject = async (p: ComposeProject) => {
    const ok = await confirm({
      title: t('启动全部容器'),
      message: t("确认启动项目「{p0}」的全部未运行容器？", { p0: p.name }),
      confirmLabel: t('启动'),
    });
    if (!ok) return;
    await runAction(
      toast,
      {
        pending: t("正在启动项目 {p0}…", { p0: p.name }),
        ok: t("项目 {p0} 已启动", { p0: p.name }),
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
    const ok = await confirm({
      title: t('停止全部容器'),
      message: t("确认停止项目「{p0}」的全部运行中容器？", { p0: p.name }),
      confirmLabel: t('停止'),
      danger: true,
    });
    if (!ok) return;
    await runAction(
      toast,
      {
        pending: t("正在停止项目 {p0}…", { p0: p.name }),
        ok: t("项目 {p0} 已停止", { p0: p.name }),
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

      {error && <ListError error={error} onRetry={() => void load()} />}

      {loading && projects.length === 0 && !error ? (
        <ListLoading label={t('正在加载 Compose 项目…')} />
      ) : projects.length === 0 ? (
        <div className="empty-state">
          <Layers size={32} strokeWidth={1.2} color="var(--text-muted)" />
          <h3>{t('没有发现 Compose 项目')}</h3>
          <p>{t('由 docker compose 启动的容器会按项目自动归类展示')}</p>
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
                      title: p.name,
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
                    <th>{t('服务')}</th>
                    <th>{t('容器')}</th>
                    <th>{t('镜像')}</th>
                    <th>{t('状态')}</th>
                    <th>{t('副本')}</th>
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
                            title: t("容器: {p0}", { p0: s.containerName || s.name }),
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
      {confirmDialog}
    </div>
  );
}
