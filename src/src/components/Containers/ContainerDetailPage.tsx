import { useEffect, useState, useCallback, useRef } from 'react';
import {
  RefreshCw,
  Play,
  Square,
  RotateCw,
  Trash2,
  FileText,
  Terminal as TermIcon,
  Cpu,
  HardDrive,
  Network,
} from 'lucide-react';
import type { ContainerDetail, ContainerStatsSample } from '../../types/docker';
import { useAppStore } from '../../stores/appStore';
import { reportError } from '../../utils/connection';
import { useConfirm } from '../../utils/useConfirm';

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
  const { toast, openTab, closeTab, containersVersion } = useAppStore();
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
    // slow fallback poll for static fields (state, exit code, mounts…)
    const t = setInterval(() => void load(), 15000);
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

  const action = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      toast(msg, 'success');
      await load();
    } catch (e) {
      reportError(e, toast);
    }
  };

  const cpu = live?.cpuPercent ?? detail?.cpuPercent ?? 0;
  const memUsage = live?.memUsage ?? detail?.memUsage ?? 0;
  const memLimit = live?.memLimit ?? detail?.memLimit ?? 0;
  const memPercent = live?.memPercent ?? (memLimit > 0 ? (memUsage / memLimit) * 100 : 0);
  const netRx = live?.netRx ?? detail?.netRx ?? 0;
  const netTx = live?.netTx ?? detail?.netTx ?? 0;
  const blockRead = live?.blockRead ?? detail?.blockRead ?? 0;
  const blockWrite = live?.blockWrite ?? detail?.blockWrite ?? 0;

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-title">
          <span className={`chip ${detail?.state || ''}`}>
            <span className="dot" />
            {detail?.state || 'unknown'}
          </span>
          {detail?.name || containerId.slice(0, 12)}
        </div>
        <div style={{ flex: 1 }} />
        <button className="btn" onClick={load} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'spinner' : ''} /> 刷新
        </button>
        <button className="btn" onClick={() => action(() => window.dockerApi.startContainer(hostId, containerId), '已启动')}>
          <Play size={13} /> 启动
        </button>
        <button className="btn" onClick={() => action(() => window.dockerApi.stopContainer(hostId, containerId), '已停止')}>
          <Square size={13} /> 停止
        </button>
        <button className="btn" onClick={() => action(() => window.dockerApi.restartContainer(hostId, containerId), '已重启')}>
          <RotateCw size={13} /> 重启
        </button>
        <button
          className="btn"
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
        <button
          className="btn danger"
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
                closeTab(`containerDetail:${hostId}:${containerId}`);
              }, '已删除');
            })();
          }}
        >
          <Trash2 size={13} /> 删除
        </button>
      </div>

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
              {detail.status} · 退出码 {detail.exitCode ?? '-'}
              {detail.oomKilled ? ' · OOM' : ''}
            </dd>
            <dt>启动时间</dt>
            <dd>{detail.startedAt || '-'}</dd>
            <dt>结束时间</dt>
            <dd>{detail.finishedAt || '-'}</dd>
            <dt>重启次数</dt>
            <dd>{detail.restartCount ?? 0}</dd>
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
            <dd>
              {detail.ports
                .map((p) => `${p.ip || '0.0.0.0'}:${p.publicPort || '-'} → ${p.privatePort}/${p.type}`)
                .join('\n') || '-'}
            </dd>
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
