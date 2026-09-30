import { useEffect, useState, useCallback } from 'react';
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
import type { ContainerDetail } from '../../types/docker';
import { useAppStore } from '../../stores/appStore';
import { reportError } from '../../utils/connection';

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
  const { toast, openTab, closeTab } = useAppStore();
  const [detail, setDetail] = useState<ContainerDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    const t = setInterval(() => void load(), 8000);
    return () => clearInterval(t);
  }, [load]);

  const action = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      toast(msg, 'success');
      await load();
    } catch (e) {
      reportError(e, toast);
    }
  };

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
            if (!confirm('确认删除该容器？')) return;
            void action(async () => {
              await window.dockerApi.removeContainer(hostId, containerId, true);
              closeTab(`containerDetail:${hostId}:${containerId}`);
            }, '已删除');
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
              <div className="stat-label">CPU</div>
              <div className="stat-value">{(detail.cpuPercent || 0).toFixed(1)}%</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">内存</div>
              <div className="stat-value">{fmtBytes(detail.memUsage)}</div>
              <div className="stat-sub">
                限额 {detail.memLimit ? fmtBytes(detail.memLimit) : '无限制'}
                {detail.memLimit
                  ? ` · ${(((detail.memUsage || 0) / detail.memLimit) * 100).toFixed(1)}%`
                  : ''}
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">网络</div>
              <div className="stat-value" style={{ fontSize: 15 }}>
                ↓ {fmtBytes(detail.netRx)}
              </div>
              <div className="stat-sub">↑ {fmtBytes(detail.netTx)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">块 I/O</div>
              <div className="stat-value" style={{ fontSize: 15 }}>
                读 {fmtBytes(detail.blockRead)}
              </div>
              <div className="stat-sub">写 {fmtBytes(detail.blockWrite)}</div>
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
    </div>
  );
}
