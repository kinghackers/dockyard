import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  RefreshCw,
  Play,
  Square,
  RotateCw,
  Trash2,
  FileText,
  Terminal as TermIcon,
  Skull,
  AlertTriangle,
  ShieldOff,
  ArrowLeft,
} from 'lucide-react';
import type { ContainerDetail, ContainerStatsSample } from '../../types/docker';
import { useAppStore } from '../../stores/appStore';
import { reportError } from '../../utils/connection';
import { runAction } from '../../utils/runAction';
import { useConfirm } from '../../utils/useConfirm';
import { localizeContainerStatus, localizeContainerState, localizeRestartPolicy } from '../../utils/localize';
import { formatPortMappingsDetailed } from '../../utils/ports';
import { getContainerActions } from '../../utils/containerActions';

function fmtBytes(n: number | undefined): string {
  if (!n || n < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

export function ContainerDetailPage({ hostId, containerId }: { hostId: string; containerId: string }) {
  const toast = useAppStore((s) => s.toast);
  const openTab = useAppStore((s) => s.openTab);
  const setMainView = useAppStore((s) => s.setMainView);
  const containersVersion = useAppStore((s) => s.containersVersion);
  const connections = useAppStore((s) => s.connections);
  const [detail, setDetail] = useState<ContainerDetail | null>(null);
  const [live, setLive] = useState<ContainerStatsSample | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDialog, confirm] = useConfirm();
  const liveSupported = useRef(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await window.dockerApi.inspectContainer(hostId, containerId);
      setDetail(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [hostId, containerId]);

  useEffect(() => {
    void load();
    // slow fallback poll for static fields (state, exit code, mounts…);
    // docker events drive most reloads, and skip it while backgrounded
    const t = setInterval(() => {
      if (!document.hidden) void load();
    }, 30000);
    return () => clearInterval(t);
  }, [load]);

  // reload when docker events indicate the container changed
  useEffect(() => {
    if (containersVersion > 0) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containersVersion]);

  // live CPU / memory / net / block I/O stream while running
  const isRunning = detail?.state === 'running';
  useEffect(() => {
    if (!isRunning) {
      setLive(null);
      // allow retrying stats next time the container starts
      liveSupported.current = true;
      return;
    }
    if (!liveSupported.current) return;
    let cancelled = false;
    let close: (() => void) | null = null;
    let offData: (() => void) | null = null;
    let offErr: (() => void) | null = null;

    void (async () => {
      try {
        await window.dockerApi.openStats(hostId, containerId);
        if (cancelled) return;
        offData = window.dockerApi.onStatsData((p) => {
          if (p.hostId === hostId && p.containerId === containerId) {
            setLive(p.sample);
          }
        });
        offErr = window.dockerApi.onStatsError((p) => {
          if (p.key === `${hostId}:${containerId}`) {
            // stats may be briefly unavailable (restart race) — stop this stream
            // but keep liveSupported so the next start can retry
            close?.();
            close = null;
          }
        });
        close = () => {
          void window.dockerApi.closeStats(hostId, containerId);
        };
      } catch {
        // openStats failed (e.g. container already exited) — try again next cycle
      }
    })();

    return () => {
      cancelled = true;
      offData?.();
      offErr?.();
      close?.();
      setLive(null);
    };
  }, [hostId, containerId, isRunning]);

  const action = async (fn: () => Promise<unknown>, msg: string, pendingMsg = '处理中…') => {
    await runAction(toast, { pending: pendingMsg, ok: msg, name: detail?.name }, fn);
    await load();
  };

  const cpu = live?.cpuPercent ?? detail?.cpuPercent ?? 0;
  const memUsage = live?.memUsage ?? detail?.memUsage ?? 0;
  const memLimit = live?.memLimit ?? detail?.memLimit ?? 0;
  const memPercent = live?.memPercent ?? (memLimit > 0 ? (memUsage / memLimit) * 100 : 0);
  const netRx = live?.netRx ?? detail?.netRx ?? 0;
  const netTx = live?.netTx ?? detail?.netTx ?? 0;
  const blockRead = live?.blockRead ?? detail?.blockRead ?? 0;
  const blockWrite = live?.blockWrite ?? detail?.blockWrite ?? 0;

  const acts = detail
    ? getContainerActions(detail.state, detail.status, detail.restartCount)
    : null;

  const stopRestartLoop = async () => {
    try {
      const result = await window.dockerApi.stopRestartLoop(hostId, containerId);
      toast(
        result === 'killed'
          ? '已强制终止并关闭自动重启'
          : result === 'stopped'
            ? '已停止并关闭自动重启'
            : '已关闭自动重启',
        'success'
      );
      await load();
    } catch (e) {
      reportError(e, toast);
    }
  };

  /** Return to the list we most likely came from. */
  const goBack = () => {
    if (detail?.composeProject) {
      setMainView({
        title: `Docker-compose: ${detail.composeProject}`,
        kind: 'composeProject',
        hostId,
        projectName: detail.composeProject,
      });
    } else {
      setMainView({
        title: `容器 · ${connections.find((c) => c.id === hostId)?.name || hostId}`,
        kind: 'containers',
        hostId,
      });
    }
  };

  const openLogs = () => {
    openTab({
      id: `logs:${hostId}:${containerId}`,
      title: `日志 · ${detail?.name || ''}`,
      kind: 'logs',
      hostId,
      containerId,
    });
  };

  /** Actionable fault hints — the first things to look at when something is wrong. */
  const diagnostics = useMemo(() => {
    if (!detail) return [];
    const items: { key: string; level: 'error' | 'warning' | 'info'; text: string }[] = [];
    const exited = detail.state === 'exited' || detail.state === 'dead';
    if (detail.oomKilled) {
      items.push({
        key: 'oom',
        level: 'error',
        text: '因内存不足被杀（OOM）。可调高内存限额，或排查泄漏/缓存暴涨。',
      });
    }
    if (exited && (detail.exitCode ?? 0) !== 0) {
      items.push({
        key: 'exit',
        level: 'error',
        text: `进程异常退出，退出码 ${detail.exitCode}。请查看日志末尾的报错与堆栈。`,
      });
    }
    if (detail.health?.status === 'unhealthy') {
      const last = detail.health.log?.[detail.health.log.length - 1];
      items.push({
        key: 'unhealthy',
        level: 'error',
        text: `健康检查失败${detail.health.failingStreak ? `（连续 ${detail.health.failingStreak} 次）` : ''}${
          last?.output ? `：${String(last.output).slice(0, 160)}` : ''
        }`,
      });
    } else if (detail.health?.status === 'starting') {
      items.push({
        key: 'health-start',
        level: 'info',
        text: '健康检查进行中，尚未给出结果。',
      });
    }
    if ((detail.restartCount ?? 0) >= 3 || detail.state === 'restarting') {
      items.push({
        key: 'loop',
        level: 'warning',
        text: `频繁自动重启（已重启 ${detail.restartCount ?? 0} 次）。可先停止重启循环再排查。`,
      });
    }
    return items;
  }, [detail]);

  return (
    <div className="page">
      <div className="page-header">
        <button className="btn ghost icon-btn" title="返回列表" onClick={goBack}>
          <ArrowLeft size={15} />
        </button>
        <div className="page-title">
          <span className={`chip ${detail?.state || ''}`}>
            <span className="dot" />
            {localizeContainerState(detail?.state || '')}
          </span>
          {detail?.name || containerId.slice(0, 12)}
        </div>
        <div style={{ flex: 1 }} />
        <button className="btn" onClick={load} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'spinner' : ''} /> 刷新
        </button>
        {acts?.canStart && (
          <button
            className="btn"
            onClick={() =>
              action(
                () => window.dockerApi.startContainer(hostId, containerId),
                '已启动',
                '正在启动…'
              )
            }
          >
            <Play size={13} /> 启动
          </button>
        )}
        {acts?.canStop && (
          <button
            className="btn"
            onClick={() =>
              action(
                () => window.dockerApi.stopContainer(hostId, containerId),
                '已停止',
                '正在停止…'
              )
            }
          >
            <Square size={13} /> 停止
          </button>
        )}
        {acts?.canRestart && (
          <button
            className="btn"
            onClick={() =>
              action(
                () => window.dockerApi.restartContainer(hostId, containerId),
                '已重启',
                '正在重启…'
              )
            }
          >
            <RotateCw size={13} /> 重启
          </button>
        )}
        {acts?.canKill && (
          <button
            className="btn"
            onClick={() =>
              action(
                () => window.dockerApi.killContainer(hostId, containerId),
                '已强制终止',
                '正在强杀…'
              )
            }
          >
            <Skull size={13} /> 强杀
          </button>
        )}
        <button
          className="btn"
          disabled={!acts?.canLogs}
          onClick={() =>
            openTab({
              id: `logs:${hostId}:${containerId}`,
              title: `日志 · ${detail?.name || ''}`,
              kind: 'logs',
              hostId,
              containerId,
            })
          }
        >
          <FileText size={13} /> 日志
        </button>
        {acts?.canExec && (
          <button
            className="btn"
            onClick={() =>
              openTab({
                id: `terminal:${hostId}:${containerId}`,
                title: `终端 · ${detail?.name || ''}`,
                kind: 'terminal',
                hostId,
                containerId,
              })
            }
          >
            <TermIcon size={13} /> 终端
          </button>
        )}
        <button
          className="btn danger"
          disabled={!acts?.canRemove}
          onClick={() => {
            void (async () => {
              const ok = await confirm({
                title: '删除容器',
                message: `确认删除容器「${detail?.name || containerId.slice(0, 12)}」？此操作不可撤销。`,
                confirmLabel: '删除',
                danger: true,
              });
              if (!ok) return;
              void action(async () => {
                await window.dockerApi.removeContainer(hostId, containerId, true);
                // back to the container list on the primary surface
                setMainView({ title: `容器 · ${detail?.name || hostId}`, kind: 'containers', hostId });
              }, '已删除');
            })();
          }}
        >
          <Trash2 size={13} /> 删除
        </button>
      </div>

      {acts?.isRestartLoop && detail && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '10px 12px',
            borderRadius: 4,
            background: 'rgba(217,164,6,0.12)',
            border: '1px solid rgba(217,164,6,0.35)',
            color: 'var(--warning)',
            marginBottom: 14,
          }}
        >
          <AlertTriangle size={16} style={{ flexShrink: 0 }} />
          <div style={{ flex: 1, fontSize: 12, color: 'var(--text)' }}>
            <strong style={{ color: 'var(--warning)' }}>检测到频繁自动重启</strong>
            <span style={{ marginLeft: 8 }}>
              已重启 {detail.restartCount ?? 0} 次
              {detail.restartPolicy && detail.restartPolicy !== 'no'
                ? ` · 重启策略 ${detail.restartPolicy}`
                : ''}
              。建议先看日志定位故障原因；若需止住重启循环，可关闭自动重启并停止容器。
            </span>
          </div>
          <button className="btn" onClick={() => void stopRestartLoop()}>
            <ShieldOff size={13} /> 停止重启循环
          </button>
          <button
            className="btn"
            onClick={() =>
              openTab({
                id: `logs:${hostId}:${containerId}`,
                title: `日志 · ${detail.name || ''}`,
                kind: 'logs',
                hostId,
                containerId,
              })
            }
          >
            <FileText size={13} /> 查看日志
          </button>
        </div>
      )}

      {diagnostics.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            marginBottom: 14,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 12,
              color: 'var(--text-bright)',
            }}
          >
            <AlertTriangle size={14} color="var(--warning)" />
            <strong>排障提示</strong>
            <button className="btn ghost" style={{ marginLeft: 'auto', height: 24 }} onClick={openLogs}>
              <FileText size={12} /> 查看日志
            </button>
            {acts?.canExec && (
              <button
                className="btn ghost"
                style={{ height: 24 }}
                onClick={() =>
                  openTab({
                    id: `terminal:${hostId}:${containerId}`,
                    title: `终端 · ${detail?.name || ''}`,
                    kind: 'terminal',
                    hostId,
                    containerId,
                  })
                }
              >
                <TermIcon size={12} /> 终端
              </button>
            )}
          </div>
          {diagnostics.map((d) => (
            <div
              key={d.key}
              style={{
                display: 'flex',
                gap: 8,
                padding: '8px 12px',
                borderRadius: 4,
                fontSize: 12,
                lineHeight: 1.5,
                border: `1px solid ${
                  d.level === 'error'
                    ? 'rgba(207,91,86,0.35)'
                    : d.level === 'warning'
                      ? 'rgba(217,164,6,0.35)'
                      : 'rgba(88,157,246,0.3)'
                }`,
                background:
                  d.level === 'error'
                    ? 'rgba(207,91,86,0.12)'
                    : d.level === 'warning'
                      ? 'rgba(217,164,6,0.1)'
                      : 'rgba(88,157,246,0.08)',
                color: 'var(--text)',
              }}
            >
              <span
                style={{
                  width: 6,
                  borderRadius: 3,
                  flexShrink: 0,
                  background:
                    d.level === 'error'
                      ? 'var(--error)'
                      : d.level === 'warning'
                        ? 'var(--warning)'
                        : 'var(--info)',
                }}
              />
              {d.text}
            </div>
          ))}
        </div>
      )}

      {error && (
        <div style={{ padding: 12, borderRadius: 4, background: 'rgba(207,91,86,0.12)', color: 'var(--error)', marginBottom: 14 }}>
          {error}
        </div>
      )}

      {detail && (
        <>
          <div className="stat-grid">
            <div className="stat-card">
              <div className="stat-label">
                CPU
                {isRunning && live && (
                  <span style={{ color: 'var(--success)', fontSize: 10, marginLeft: 6, textTransform: 'none' }}>
                    ● 实时
                  </span>
                )}
              </div>
              <div className="stat-value">{cpu.toFixed(1)}%</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">内存</div>
              <div className="stat-value">{fmtBytes(memUsage)}</div>
              <div className="stat-sub">
                限额 {memLimit ? fmtBytes(memLimit) : '无限制'}
                {memLimit ? ` · ${memPercent.toFixed(1)}%` : ''}
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">网络</div>
              <div className="stat-value" style={{ fontSize: 15 }}>
                ↓ {fmtBytes(netRx)}
              </div>
              <div className="stat-sub">↑ {fmtBytes(netTx)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">块 I/O</div>
              <div className="stat-value" style={{ fontSize: 15 }}>
                读 {fmtBytes(blockRead)}
              </div>
              <div className="stat-sub">写 {fmtBytes(blockWrite)}</div>
            </div>
          </div>

          <div className="section-title">基本信息</div>
          <dl className="detail-grid">
            <dt>ID</dt>
            <dd>{detail.id}</dd>
            <dt>镜像</dt>
            <dd>{detail.image}</dd>
            <dt>命令</dt>
            <dd>{detail.command || '-'}</dd>
            <dt>状态</dt>
            <dd>
              {localizeContainerStatus(detail.status)} · 退出码 {detail.exitCode ?? '-'}
              {detail.oomKilled ? ' · OOM' : ''}
              {detail.health?.status ? ` · 健康检查 ${detail.health.status}` : ''}
            </dd>
            <dt>启动时间</dt>
            <dd>{detail.startedAt || '-'}</dd>
            <dt>结束时间</dt>
            <dd>{detail.finishedAt || '-'}</dd>
            <dt>重启次数</dt>
            <dd>
              {detail.restartCount ?? 0}
              {(detail.restartCount ?? 0) >= 3 ? (
                <span style={{ color: 'var(--warning)', marginLeft: 8, fontSize: 11 }}>
                  频繁重启
                </span>
              ) : null}
            </dd>
            <dt>重启策略</dt>
            <dd>{localizeRestartPolicy(detail.restartPolicy)}</dd>
            <dt>主机名</dt>
            <dd>{detail.hostname || '-'}</dd>
            <dt>工作目录</dt>
            <dd>{detail.workingDir || '-'}</dd>
            <dt>平台</dt>
            <dd>{detail.platform || '-'}</dd>
            {detail.composeProject && (
              <>
                <dt>Compose 项目</dt>
                <dd>{detail.composeProject}</dd>
                <dt>Compose 服务</dt>
                <dd>{detail.composeService || '-'}</dd>
              </>
            )}
            <dt>网络</dt>
            <dd>{(detail.networks || []).join(', ') || '-'}</dd>
            <dt>端口</dt>
            <dd style={{ whiteSpace: 'pre-line' }}>{formatPortMappingsDetailed(detail.ports)}</dd>
          </dl>

          {detail.mounts && detail.mounts.length > 0 && (
            <>
              <div className="section-title">挂载</div>
              <table className="table">
                <thead>
                  <tr>
                    <th>类型</th>
                    <th>源</th>
                    <th>目标</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.mounts.map((m, i) => (
                    <tr key={i} style={{ cursor: 'default' }}>
                      <td>{m.type || '-'}</td>
                      <td className="mono">{m.source || '-'}</td>
                      <td className="mono">{m.destination || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {detail.env && detail.env.length > 0 && (
            <>
              <div className="section-title">环境变量</div>
              <div
                className="log-view"
                style={{ maxHeight: 220, overflow: 'auto', fontSize: 11 }}
              >
                {detail.env.map((e, i) => (
                  <div key={i}>{e}</div>
                ))}
              </div>
            </>
          )}
        </>
      )}
      {confirmDialog}
    </div>
  );
}
