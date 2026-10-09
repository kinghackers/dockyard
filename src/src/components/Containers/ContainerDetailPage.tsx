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
  Save,
  Pencil,
  FolderOpen,
} from 'lucide-react';
import type { ContainerDetail, ContainerStatsSample } from '../../types/docker';
import { useAppStore } from '../../stores/appStore';
import { reportError } from '../../utils/connection';
import { runAction } from '../../utils/runAction';
import { useConfirm } from '../../utils/useConfirm';
import { InputDialog } from '../common/InputDialog';
import { usePolling } from '../../hooks/usePolling';
import { ContainerFilesDialog } from './ContainerFilesDialog';
import { localizeContainerStatus, localizeContainerState, localizeRestartPolicy } from '../../utils/localize';
import { formatPortMappingsDetailed } from '../../utils/ports';
import { getContainerActions, stopRestartLoop } from '../../utils/containerActions';
import { fmtBytes } from '../../utils/format';
import { t, useT } from '../../i18n';

export function ContainerDetailPage({
  hostId,
  containerId,
  active = true,
}: {
  hostId: string;
  containerId: string;
  /** false while the tab is hidden (keep-alive) — polling pauses */
  active?: boolean;
}) {
  const t = useT();
  const toast = useAppStore((s) => s.toast);
  const openTab = useAppStore((s) => s.openTab);
  const containersVersion = useAppStore((s) => s.containersVersion);
  const connections = useAppStore((s) => s.connections);
  const [detail, setDetail] = useState<ContainerDetail | null>(null);
  const [live, setLive] = useState<ContainerStatsSample | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [commitOpen, setCommitOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [memLimitMB, setMemLimitMB] = useState('');
  const [cpuCores, setCpuCores] = useState('');
  const [savingRes, setSavingRes] = useState(false);
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

  // slow fallback poll for static fields (state, exit code, mounts…);
  // docker events drive most reloads. The hook skips ticks while hidden
  // and catches up immediately when the tab becomes visible again.
  usePolling({
    active: active ?? true,
    reloadKey: `${hostId}:${containerId}`,
    intervalMs: 30000,
    onLoad: load,
  });

  // reload when docker events indicate the container changed
  useEffect(() => {
    if (containersVersion > 0) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containersVersion]);

  // seed the resource-limit inputs from the inspected config
  useEffect(() => {
    setMemLimitMB(
      detail?.memLimitConfigured ? String(Math.round(detail.memLimitConfigured / 1048576)) : ''
    );
    setCpuCores(detail?.nanoCpus ? String(detail.nanoCpus / 1e9) : '');
  }, [detail?.id, detail?.memLimitConfigured, detail?.nanoCpus]);

  const saveResources = async () => {
    const opts: { memoryMB?: number; cpuCores?: number } = {};
    const m = Number(memLimitMB);
    const c = Number(cpuCores);
    if (memLimitMB.trim() && Number.isFinite(m) && m > 0) opts.memoryMB = m;
    if (cpuCores.trim() && Number.isFinite(c) && c > 0) opts.cpuCores = c;
    if (Object.keys(opts).length === 0) {
      toast(t('请至少填写一项要修改的限制'), 'error');
      return;
    }
    setSavingRes(true);
    try {
      await window.dockerApi.updateContainerResources(hostId, containerId, opts);
      toast(t('资源限制已更新'), 'success');
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setSavingRes(false);
    }
  };

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

  const action = async (fn: () => Promise<unknown>, msg: string, pendingMsg = t('处理中…')) => {
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

  const stopRestartLoopHere = async () => {
    try {
      const msg = await stopRestartLoop(hostId, containerId);
      toast(msg, 'success');
      await load();
    } catch (e) {
      reportError(e, toast);
    }
  };

  /** Return to the list we most likely came from — inside the host's own tab. */
  const goBack = () => {
    if (detail?.composeProject) {
      openTab({
        id: `composeProject:${hostId}:${detail.composeProject}`,
        title: `Docker-compose: ${detail.composeProject}`,
        kind: 'composeProject',
        hostId,
        projectName: detail.composeProject,
      });
    } else {
      openTab({
        id: `containers:${hostId}`,
        title: t("容器 · {p0}", { p0: connections.find((c) => c.id === hostId)?.name || hostId }),
        kind: 'containers',
        hostId,
      });
    }
  };

  const openLogs = () => {
    openTab({
      id: `logs:${hostId}:${containerId}`,
      title: t("日志 · {p0}", { p0: detail?.name || '' }),
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
        text: t('因内存不足被杀（OOM）。可调高内存限额，或排查泄漏/缓存暴涨。'),
      });
    }
    if (exited && (detail.exitCode ?? 0) !== 0) {
      items.push({
        key: 'exit',
        level: 'error',
        text: t("进程异常退出，退出码 {p0}。请查看日志末尾的报错与堆栈。", { p0: detail.exitCode }),
      });
    }
    if (detail.health?.status === 'unhealthy') {
      const last = detail.health.log?.[detail.health.log.length - 1];
      items.push({
        key: 'unhealthy',
        level: 'error',
        text:
          t('健康检查失败{p0}', {
            p0: detail.health.failingStreak ? t('（连续 {p0} 次）', { p0: detail.health.failingStreak }) : '',
          }) + (last?.output ? t('：{p0}', { p0: String(last.output).slice(0, 160) }) : ''),
      });
    } else if (detail.health?.status === 'starting') {
      items.push({
        key: 'health-start',
        level: 'info',
        text: t('健康检查进行中，尚未给出结果。'),
      });
    }
    if ((detail.restartCount ?? 0) >= 3 || detail.state === 'restarting') {
      items.push({
        key: 'loop',
        level: 'warning',
        text: t("频繁自动重启（已重启 {p0} 次）。可先停止重启循环再排查。", { p0: detail.restartCount ?? 0 }),
      });
    }
    return items;
  }, [detail]);

  return (
    <div className="page">
      <div className="page-header">
        <button className="btn ghost icon-btn" title={t('返回列表')} onClick={goBack}>
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
          <RefreshCw size={14} className={loading ? 'spinner' : ''} /> {t('刷新')}
        </button>
        {acts?.canStart && (
          <button
            className="btn"
            onClick={() =>
              action(
                () => window.dockerApi.startContainer(hostId, containerId),
                t('已启动'),
                t('正在启动…')
              )
            }
          >
            <Play size={13} /> {t('启动')}
          </button>
        )}
        {acts?.canStop && (
          <button
            className="btn"
            onClick={() =>
              action(
                () => window.dockerApi.stopContainer(hostId, containerId),
                t('已停止'),
                t('正在停止…')
              )
            }
          >
            <Square size={13} /> {t('停止')}
          </button>
        )}
        {acts?.canRestart && (
          <button
            className="btn"
            onClick={() =>
              action(
                () => window.dockerApi.restartContainer(hostId, containerId),
                t('已重启'),
                t('正在重启…')
              )
            }
          >
            <RotateCw size={13} /> {t('重启')}
          </button>
        )}
        {acts?.canKill && (
          <button
            className="btn"
            onClick={() =>
              action(
                () => window.dockerApi.killContainer(hostId, containerId),
                t('已强制终止'),
                t('正在强杀…')
              )
            }
          >
            <Skull size={13} /> {t('强制终止')}
          </button>
        )}
        <button className="btn" onClick={() => setFilesOpen(true)} title={t('浏览容器文件系统，支持上传/下载')}>
          <FolderOpen size={13} /> {t('文件')}
        </button>
        <button
          className="btn"
          onClick={() => setCommitOpen(true)}
          title={t('将容器当前文件系统状态提交为新镜像（docker commit）')}
        >
          <Save size={13} /> {t('另存为镜像')}…
        </button>
        <button className="btn" onClick={() => setRenameOpen(true)}>
          <Pencil size={13} /> {t('重命名')}…
        </button>
        <button
          className="btn"
          disabled={!acts?.canLogs}
          onClick={() =>
            openTab({
              id: `logs:${hostId}:${containerId}`,
              title: t("日志 · {p0}", { p0: detail?.name || '' }),
              kind: 'logs',
              hostId,
              containerId,
            })
          }
        >
          <FileText size={13} /> {t('日志')}
        </button>
        {acts?.canExec && (
          <button
            className="btn"
            onClick={() =>
              openTab({
                id: `terminal:${hostId}:${containerId}`,
                title: t("终端 · {p0}", { p0: detail?.name || '' }),
                kind: 'terminal',
                hostId,
                containerId,
              })
            }
          >
            <TermIcon size={13} /> {t('终端')}
          </button>
        )}
        <button
          className="btn danger"
          disabled={!acts?.canRemove}
          onClick={() => {
            void (async () => {
              const ok = await confirm({
                title: t('删除容器'),
                message: t("确认删除容器「{p0}」？此操作不可撤销。", { p0: detail?.name || containerId.slice(0, 12) }),
                confirmLabel: t('删除'),
                danger: true,
              });
              if (!ok) return;
              void action(async () => {
                await window.dockerApi.removeContainer(hostId, containerId, true);
                // back to the container list inside the host's tab
                openTab({
                  id: `containers:${hostId}`,
                  title: t("容器 · {p0}", { p0: connections.find((c) => c.id === hostId)?.name || hostId }),
                  kind: 'containers',
                  hostId,
                });
              }, t('已删除'));
            })();
          }}
        >
          <Trash2 size={13} /> {t('删除')}
        </button>
      </div>

      {acts?.isRestartLoop && detail && (
        <div className="alert" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <AlertTriangle size={16} style={{ flexShrink: 0 }} />
          <div style={{ flex: 1, fontSize: 12, color: 'var(--text)' }}>
            <strong style={{ color: 'var(--warning)' }}>{t('检测到频繁自动重启')}</strong>
            <span style={{ marginLeft: 8 }}>
              {t('已重启 {p0} 次', { p0: detail.restartCount ?? 0 })}
              {detail.restartPolicy && detail.restartPolicy !== 'no'
                ? t(" · 重启策略 {p0}", { p0: detail.restartPolicy })
                : ''}
              {t('建议先看日志定位故障原因；若需止住重启循环，可关闭自动重启并停止容器。')}
            </span>
          </div>
          <button className="btn" onClick={() => void stopRestartLoopHere()}>
            <ShieldOff size={13} /> {t('停止重启循环')}
          </button>
          <button
            className="btn"
            onClick={() =>
              openTab({
                id: `logs:${hostId}:${containerId}`,
                title: t("日志 · {p0}", { p0: detail.name || '' }),
                kind: 'logs',
                hostId,
                containerId,
              })
            }
          >
            <FileText size={13} /> {t('查看日志')}
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
            <strong>{t('排障提示')}</strong>
            <button className="btn ghost" style={{ marginLeft: 'auto', height: 24 }} onClick={openLogs}>
              <FileText size={12} /> {t('查看日志')}
            </button>
            {acts?.canExec && (
              <button
                className="btn ghost"
                style={{ height: 24 }}
                onClick={() =>
                  openTab({
                    id: `terminal:${hostId}:${containerId}`,
                    title: t("终端 · {p0}", { p0: detail?.name || '' }),
                    kind: 'terminal',
                    hostId,
                    containerId,
                  })
                }
              >
                <TermIcon size={12} /> {t('终端')}
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
                    ? 'var(--error-border)'
                    : d.level === 'warning'
                      ? 'var(--warn-border)'
                      : 'var(--info-border)'
                }`,
                background:
                  d.level === 'error'
                    ? 'var(--error-soft)'
                    : d.level === 'warning'
                      ? 'var(--warn-soft)'
                      : 'var(--info-soft)',
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
        <div className="alert danger" style={{ marginBottom: 14 }}>
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
                    ● {t('实时')}
                  </span>
                )}
              </div>
              <div className="stat-value">{cpu.toFixed(1)}%</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">{t('内存')}</div>
              <div className="stat-value">{fmtBytes(memUsage)}</div>
              <div className="stat-sub">
                {t('限额')} {memLimit ? fmtBytes(memLimit) : t('无限制')}
                {memLimit ? ` · ${memPercent.toFixed(1)}%` : ''}
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">{t('网络')}</div>
              <div className="stat-value" style={{ fontSize: 15 }}>
                ↓ {fmtBytes(netRx)}
              </div>
              <div className="stat-sub">↑ {fmtBytes(netTx)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">{t('块 I/O')}</div>
              <div className="stat-value" style={{ fontSize: 15 }}>
                {t('读')}{fmtBytes(blockRead)}
              </div>
              <div className="stat-sub">{t('写')}{fmtBytes(blockWrite)}</div>
            </div>
          </div>

          <div className="section-title">{t('基本信息')}</div>
          <dl className="detail-grid">
            <dt>ID</dt>
            <dd>{detail.id}</dd>
            <dt>{t('镜像')}</dt>
            <dd>{detail.image}</dd>
            <dt>{t('命令')}</dt>
            <dd>{detail.command || '-'}</dd>
            <dt>{t('状态')}</dt>
            <dd>
              {localizeContainerStatus(detail.status)} · {t('退出码')} {detail.exitCode ?? '-'}
              {detail.oomKilled ? ' · OOM' : ''}
              {detail.health?.status ? t(" · 健康检查 {p0}", { p0: detail.health.status }) : ''}
            </dd>
            <dt>{t('启动时间')}</dt>
            <dd>{detail.startedAt || '-'}</dd>
            <dt>{t('结束时间')}</dt>
            <dd>{detail.finishedAt || '-'}</dd>
            <dt>{t('重启次数')}</dt>
            <dd>
              {detail.restartCount ?? 0}
              {(detail.restartCount ?? 0) >= 3 ? (
                <span style={{ color: 'var(--warning)', marginLeft: 8, fontSize: 11 }}>
                  {t('频繁重启')}
                </span>
              ) : null}
            </dd>
            <dt>{t('重启策略')}</dt>
            <dd>{localizeRestartPolicy(detail.restartPolicy)}</dd>
            <dt>{t('主机名')}</dt>
            <dd>{detail.hostname || '-'}</dd>
            <dt>{t('工作目录')}</dt>
            <dd>{detail.workingDir || '-'}</dd>
            <dt>{t('平台')}</dt>
            <dd>{detail.platform || '-'}</dd>
            {detail.composeProject && (
              <>
                <dt>{t('Compose 项目')}</dt>
                <dd>{detail.composeProject}</dd>
                <dt>{t('Compose 服务')}</dt>
                <dd>{detail.composeService || '-'}</dd>
              </>
            )}
            <dt>{t('网络')}</dt>
            <dd>{(detail.networks || []).join(', ') || '-'}</dd>
            <dt>{t('端口')}</dt>
            <dd style={{ whiteSpace: 'pre-line' }}>{formatPortMappingsDetailed(detail.ports)}</dd>
          </dl>

          {detail.health && (
            <>
              <div className="section-title">{t('健康检查')}</div>
              <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>
                {t('状态')} {detail.health.status || '-'}
                {detail.health.failingStreak ? t(" · 连续失败 {p0} 次", { p0: detail.health.failingStreak }) : ''}
                {' · '}{t('最近 {p0} 次探测：', { p0: Math.min(detail.health.log?.length || 0, 5) })}
              </div>
              <div className="log-view" style={{ maxHeight: 240, overflow: 'auto', fontSize: 11 }}>
                {(detail.health.log || []).slice(-5).reverse().map((h, i) => (
                  <div key={i}>
                    <span className="log-line-ts">
                      [{h.start ? h.start.replace(/\.\d+Z?$/, '').replace('T', ' ') : '-'}]{' '}
                    </span>
                    {t('退出码 {p0}：', { p0: h.exitCode ?? '-' })}{String(h.output || '').trim().slice(0, 400) || t('(无输出)')}
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="section-title">{t('资源限制')}</div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div className="form-row" style={{ width: 180 }}>
              <label>{t('内存上限 (MB)')}</label>
              <input
                type="number"
                value={memLimitMB}
                placeholder={t('不限制')}
                onChange={(e) => setMemLimitMB(e.target.value)}
              />
            </div>
            <div className="form-row" style={{ width: 180 }}>
              <label>{t('CPU 核数')}</label>
              <input
                type="number"
                step="0.5"
                value={cpuCores}
                placeholder={t('不限制')}
                onChange={(e) => setCpuCores(e.target.value)}
              />
            </div>
            <button className="btn" onClick={() => void saveResources()} disabled={savingRes}>
              {savingRes ? t('应用中…') : t('应用')}
            </button>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
            {t('留空表示不修改该项；修改对运行中的容器即时生效（docker update）。')}
          </div>

          {detail.mounts && detail.mounts.length > 0 && (
            <>
              <div className="section-title">{t('挂载')}</div>
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('类型')}</th>
                    <th>{t('源')}</th>
                    <th>{t('目标')}</th>
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
              <div className="section-title">{t('环境变量')}</div>
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
      {commitOpen && (
        <InputDialog
          title={t('另存为镜像')}
          label={t('镜像仓库:标签')}
          initial={`${detail?.name || 'snapshot'}:latest`}
          placeholder="myapp:snapshot"
          confirmLabel={t('提交')}
          onClose={() => setCommitOpen(false)}
          onSubmit={async (value) => {
            const idx = value.lastIndexOf(':');
            const repo = idx > 0 ? value.slice(0, idx) : value;
            const tag = idx > 0 ? value.slice(idx + 1) : undefined;
            try {
              const imageId = await window.dockerApi.commitContainer(hostId, containerId, {
                repo,
                tag,
              });
              toast(
                t('已提交为新镜像{p0}', { p0: imageId ? ` (${imageId.slice(7, 19)})` : '' }),
                'success'
              );
              setCommitOpen(false);
            } catch (e) {
              toast(e instanceof Error ? e.message : String(e), 'error');
            }
          }}
        />
      )}
      {renameOpen && detail && (
        <InputDialog
          title={t('重命名容器')}
          label={t('容器名称')}
          initial={detail.name}
          confirmLabel={t('重命名')}
          onClose={() => setRenameOpen(false)}
          onSubmit={async (name) => {
            try {
              await window.dockerApi.renameContainer(hostId, containerId, name);
              toast(t('已重命名'), 'success');
              setRenameOpen(false);
              await load();
            } catch (e) {
              toast(e instanceof Error ? e.message : String(e), 'error');
            }
          }}
        />
      )}
      {filesOpen && (
        <ContainerFilesDialog hostId={hostId} containerId={containerId} onClose={() => setFilesOpen(false)} />
      )}
      {confirmDialog}
    </div>
  );
}
