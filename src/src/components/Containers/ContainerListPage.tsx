import { useEffect, useState, useCallback, useMemo } from 'react';
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
} from 'lucide-react';
import type { ContainerSummary } from '../../types/docker';
import { useAppStore } from '../../stores/appStore';
import { reportError } from '../../utils/connection';
import { useConfirm } from '../../utils/useConfirm';
import { localizeStatusChip, localizeContainerStatus } from '../../utils/localize';
import { formatPortMappings } from '../../utils/ports';
import { getContainerActions } from '../../utils/containerActions';
import { RunContainerDialog } from './RunContainerDialog';
import { ContainerRowActions } from './ContainerRowActions';

export function ContainerListPage({ hostId }: { hostId: string }) {
  const { openTab, toast, setContainers, containersByHost, containersVersion } = useAppStore();
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');
  const [stateFilter, setStateFilter] = useState<'all' | 'running' | 'exited' | 'paused'>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [runOpen, setRunOpen] = useState(false);
  const [confirmDialog, confirm] = useConfirm();
  const list = containersByHost[hostId] || [];

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await window.dockerApi.listContainers(hostId, true);
      setContainers(hostId, data);
    } catch (e) {
      reportError(e, toast);
    } finally {
      setLoading(false);
    }
  }, [hostId, setContainers, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  // auto-refresh when docker events fire
  useEffect(() => {
    if (containersVersion > 0) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containersVersion]);

  const filtered = useMemo(() => {
    return list.filter((c) => {
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
  }, [list, filter, stateFilter]);

  const action = async (fn: () => Promise<unknown>, okMsg: string) => {
    try {
      await fn();
      toast(okMsg, 'success');
      await load();
    } catch (e) {
      reportError(e, toast);
    }
  };

  const selectedContainer = useMemo(
    () => list.find((c) => c.id === selected) || null,
    [list, selected]
  );
  const selActions = selectedContainer
    ? getContainerActions(selectedContainer.state, selectedContainer.status)
    : null;

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
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
          onClick={() => selected && action(() => window.dockerApi.startContainer(hostId, selected), '已启动')}
        >
          <Play size={13} /> 启动
        </button>
        <button
          className="btn"
          disabled={!selected || !selActions?.canStop}
          onClick={() => selected && action(() => window.dockerApi.stopContainer(hostId, selected), '已停止')}
        >
          <Square size={13} /> 停止
        </button>
        <button
          className="btn"
          disabled={!selected || !selActions?.canRestart}
          onClick={() => selected && action(() => window.dockerApi.restartContainer(hostId, selected), '已重启')}
        >
          <RotateCw size={13} /> 重启
        </button>
        <button
          className="btn"
          disabled={!selected || !selActions?.canPause}
          onClick={() =>
            selected &&
            action(() => window.dockerApi.pauseContainer(hostId, selected), '已暂停')
          }
        >
          <Pause size={13} /> 暂停
        </button>
        <button
          className="btn"
          disabled={!selected || !selActions?.canUnpause}
          onClick={() =>
            selected &&
            action(() => window.dockerApi.unpauseContainer(hostId, selected), '已恢复')
          }
        >
          <PlayCircle size={13} /> 恢复
        </button>
        <button
          className="btn"
          disabled={!selected || !selActions?.canKill}
          title="强制终止"
          onClick={() => selected && action(() => window.dockerApi.killContainer(hostId, selected), '已强制终止')}
        >
          <Skull size={13} /> 强杀
        </button>
        <button
          className="btn"
          disabled={!selected}
          onClick={() => {
            if (!selected) return;
            openTab({
              id: `logs:${hostId}:${selected}`,
              title: `日志 · ${list.find((c) => c.id === selected)?.name || ''}`,
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
              title: `终端 · ${list.find((c) => c.id === selected)?.name || ''}`,
              kind: 'terminal',
              hostId,
              containerId: selected,
            });
          }}
        >
          <TermIcon size={13} /> 终端
        </button>
        <button
          className="btn danger"
          disabled={!selected || !selActions?.canRemove}
          onClick={() => {
            if (!selected) return;
            void (async () => {
              const ok = await confirm({
                title: '删除容器',
                message: '确认删除该容器？数据卷将一并移除。',
                confirmLabel: '删除',
                danger: true,
              });
              if (!ok) return;
              action(() => window.dockerApi.removeContainer(hostId, selected, true), '已删除');
            })();
          }}
        >
          <Trash2 size={13} /> 删除
        </button>
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
              className="search-input"
              style={{ paddingLeft: 26 }}
              placeholder="过滤名称 / 镜像 / 项目"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {filtered.length === 0 ? (
          <div className="empty-state">
            <p>{list.length === 0 ? '暂无容器' : '没有匹配的容器'}</p>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 28 }}></th>
                <th>名称</th>
                <th>状态</th>
                <th>镜像</th>
                <th>项目</th>
                <th>端口</th>
                <th>创建时间</th>
                <th style={{ width: 140 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
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
                  <td style={{ color: 'var(--text-bright)' }}>{c.name}</td>
                  <td>
                    <span className={`chip ${c.state}`}>
                      <span className="dot" />
                      <span title={localizeContainerStatus(c.status)}>
                        {localizeStatusChip(c.status, c.state)}
                      </span>
                    </span>
                  </td>
                  <td className="mono" style={{ color: 'var(--text-dim)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>
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
                      onStart={() => void action(() => window.dockerApi.startContainer(hostId, c.id), '已启动')}
                      onStop={() => void action(() => window.dockerApi.stopContainer(hostId, c.id), '已停止')}
                      onRestart={() => void action(() => window.dockerApi.restartContainer(hostId, c.id), '已重启')}
                      onPause={() => void action(() => window.dockerApi.pauseContainer(hostId, c.id), '已暂停')}
                      onUnpause={() => void action(() => window.dockerApi.unpauseContainer(hostId, c.id), '已恢复')}
                      onKill={() => void action(() => window.dockerApi.killContainer(hostId, c.id), '已强制终止')}
                      onStopRestartLoop={() => void stopRestartLoop(c.id, c.name)}
                      extra={
                        <>
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
                          <button
                            className="btn ghost icon-btn danger-text"
                            title="删除"
                            onClick={(e) => {
                              e.stopPropagation();
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
    </div>
  );
}
