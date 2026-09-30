import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  RefreshCw,
  Play,
  Square,
  RotateCw,
  FileText,
  Terminal as TermIcon,
  Layers,
} from 'lucide-react';
import type { ContainerSummary, ComposeProject } from '../../types/docker';
import { useAppStore } from '../../stores/appStore';
import { reportError } from '../../utils/connection';
import { localizeStatusChip, localizeContainerStatus } from '../../utils/localize';
import { ContainerRowActions } from '../Containers/ContainerRowActions';

export function ComposeProjectPage({ hostId, projectName }: { hostId: string; projectName: string }) {
  const { toast, openTab, containersVersion } = useAppStore();
  const [containers, setContainers] = useState<ContainerSummary[]>([]);
  const [project, setProject] = useState<ComposeProject | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [projects, all] = await Promise.all([
        window.dockerApi.listComposeProjects(hostId),
        window.dockerApi.listContainers(hostId, true),
      ]);
      const p = projects.find((x) => x.name === projectName) || null;
      setProject(p);
      setContainers(all.filter((c) => c.composeProject === projectName));
    } catch (e) {
      reportError(e, toast);
    } finally {
      setLoading(false);
    }
  }, [hostId, projectName, toast]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 8000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (containersVersion > 0) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containersVersion]);

  const action = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      toast(msg, 'success');
      await load();
    } catch (e) {
      reportError(e, toast);
    }
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

  const running = useMemo(() => containers.filter((c) => c.state === 'running').length, [containers]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="content-toolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 8 }}>
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
          onClick={() =>
            action(async () => {
              for (const c of containers) {
                if (c.state !== 'running') await window.dockerApi.startContainer(hostId, c.id);
              }
            }, '项目已启动')
          }
        >
          <Play size={13} /> 启动全部
        </button>
        <button
          className="btn"
          onClick={() =>
            action(async () => {
              for (const c of containers) {
                if (c.state === 'running') await window.dockerApi.stopContainer(hostId, c.id);
              }
            }, '项目已停止')
          }
        >
          <Square size={13} /> 停止全部
        </button>
        <button
          className="btn"
          onClick={() =>
            action(async () => {
              for (const c of containers) await window.dockerApi.restartContainer(hostId, c.id);
            }, '项目已重启')
          }
        >
          <RotateCw size={13} /> 重启全部
        </button>
        <div style={{ flex: 1 }} />
        <button
          className="btn"
          disabled={!selected}
          onClick={() => {
            if (!selected) return;
            openTab({
              id: `logs:${hostId}:${selected}`,
              title: `日志 · ${containers.find((c) => c.id === selected)?.name || ''}`,
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
          disabled={!selected}
          onClick={() => {
            if (!selected) return;
            openTab({
              id: `terminal:${hostId}:${selected}`,
              title: `终端 · ${containers.find((c) => c.id === selected)?.name || ''}`,
              kind: 'terminal',
              hostId,
              containerId: selected,
            });
          }}
        >
          <TermIcon size={13} /> 终端
        </button>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {containers.length === 0 ? (
          <div className="empty-state">
            <p>该项目下没有容器</p>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 28 }}></th>
                <th>服务</th>
                <th>容器</th>
                <th>状态</th>
                <th>镜像</th>
                <th>端口</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {containers.map((c) => (
                <tr
                  key={c.id}
                  className={selected === c.id ? 'selected' : ''}
                  onClick={() => setSelected(c.id)}
                  onDoubleClick={() =>
                    openTab({
                      id: `containerDetail:${hostId}:${c.id}`,
                      title: `容器: ${c.name}`,
                      kind: 'containerDetail',
                      hostId,
                      containerId: c.id,
                    })
                  }
                >
                  <td>
                    <input
                      type="radio"
                      checked={selected === c.id}
                      onChange={() => setSelected(c.id)}
                      style={{ width: 12, height: 12 }}
                    />
                  </td>
                  <td style={{ color: 'var(--compose)', fontWeight: 500 }}>{c.composeService || '-'}</td>
                  <td style={{ color: 'var(--text-bright)' }}>{c.name}</td>
                  <td>
                    <span className={`chip ${c.state}`}>
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
                    {c.ports
                      .filter((p) => p.publicPort)
                      .map((p) => `${p.publicPort}→${p.privatePort}`)
                      .join(', ') || '-'}
                  </td>
                  <td>
                    <ContainerRowActions
                      container={c}
                      onStart={() => void action(() => window.dockerApi.startContainer(hostId, c.id), '已启动')}
                      onStop={() => void action(() => window.dockerApi.stopContainer(hostId, c.id), '已停止')}
                      onRestart={() => void action(() => window.dockerApi.restartContainer(hostId, c.id), '已重启')}
                      onPause={() => void action(() => window.dockerApi.pauseContainer(hostId, c.id), '已暂停')}
                      onUnpause={() => void action(() => window.dockerApi.unpauseContainer(hostId, c.id), '已恢复')}
                      onKill={() => void action(() => window.dockerApi.killContainer(hostId, c.id), '已强制终止')}
                      onStopRestartLoop={() => void stopRestartLoop(c.id, c.name)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
