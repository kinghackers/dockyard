import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, Cpu, HardDrive, Network, Box, Image as ImageIcon, Database, Activity } from 'lucide-react';
import type { ConnectionStatus, SystemStats, DockerInfoLite } from '../../types/docker';
import { useAppStore } from '../../stores/appStore';

function fmtBytes(n: number): string {
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

function meterClass(pct: number) {
  if (pct > 85) return 'meter error';
  if (pct > 65) return 'meter warning';
  return 'meter success';
}

export function DashboardPage({ hostId }: { hostId?: string }) {
  const { connections, statuses, setRefreshing, containersVersion } = useAppStore();
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [info, setInfo] = useState<DockerInfoLite | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targetHost = hostId || connections.find((c) => statuses[c.id]?.connected)?.id;

  const load = useCallback(async () => {
    if (!targetHost) return;
    setLoading(true);
    setRefreshing(true);
    setError(null);
    try {
      const [s, i] = await Promise.all([
        window.dockerApi.systemStats(targetHost),
        window.dockerApi.systemInfo(targetHost),
      ]);
      setStats(s);
      setInfo(i);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [targetHost, setRefreshing]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 10000);
    return () => clearInterval(t);
  }, [load]);

  // refresh sooner when docker events indicate activity
  useEffect(() => {
    if (containersVersion > 0) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containersVersion]);

  if (!targetHost) {
    return (
      <div className="page">
        <div className="empty-state">
          <h3>尚未连接任何 Docker 主机</h3>
          <p>请在左侧添加并连接一个远程 Docker 服务</p>
        </div>
      </div>
    );
  }

  const conn = connections.find((c) => c.id === targetHost);
  const status: ConnectionStatus | undefined = statuses[targetHost];

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-title">
          <Activity size={18} color="var(--accent)" />
          仪表板 · {conn?.name || targetHost}
        </div>
        <div className="page-subtitle">
          {info?.serverVersion ? `Docker ${info.serverVersion}` : ''}
          {info?.os ? ` · ${info.os}` : ''}
          {info?.arch ? ` · ${info.arch}` : ''}
        </div>
        <div style={{ flex: 1 }} />
        <button className="btn" onClick={load} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'spinner' : ''} /> 刷新
        </button>
      </div>

      {error && (
        <div
          style={{
            padding: 12,
            borderRadius: 4,
            background: 'rgba(207,91,86,0.12)',
            color: 'var(--error)',
            marginBottom: 16,
          }}
        >
          {error}
          {!status?.connected && <div style={{ marginTop: 6, fontSize: 11 }}>请先在左侧连接该主机</div>}
        </div>
      )}

      {stats && (
        <>
          <div className="stat-grid">
            <div className="stat-card">
              <div className="stat-label">运行中容器</div>
              <div className="stat-value">{stats.containersRunning}</div>
              <div className="stat-sub">共 {stats.containersTotal} 个</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">镜像</div>
              <div className="stat-value">{stats.images}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">网络</div>
              <div className="stat-value">{stats.networks}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">数据卷</div>
              <div className="stat-value">{stats.volumes}</div>
            </div>
          </div>

          <div className="section-title">资源占用</div>

          <div className="resource-row">
            <Cpu size={15} color="var(--accent)" />
            <span className="name">CPU</span>
            <div className={meterClass(stats.cpuPercent)}>
              <span style={{ width: `${Math.min(stats.cpuPercent, 100)}%` }} />
            </div>
            <span className="value">{stats.cpuPercent.toFixed(1)}%</span>
          </div>

          <div className="resource-row">
            <HardDrive size={15} color="var(--warning)" />
            <span className="name">内存</span>
            <div className={meterClass(stats.memPercent)}>
              <span style={{ width: `${Math.min(stats.memPercent, 100)}%` }} />
            </div>
            <span className="value">
              {fmtBytes(stats.memUsage)} / {fmtBytes(stats.memLimit)}
            </span>
          </div>

          <div className="resource-row">
            <Network size={15} color="var(--network)" />
            <span className="name">网络 I/O</span>
            <div style={{ flex: 1, color: 'var(--text-dim)', fontSize: 12 }}>
              ↓ {fmtBytes(stats.netRx)} &nbsp;&nbsp; ↑ {fmtBytes(stats.netTx)}
            </div>
          </div>

          <div className="resource-row">
            <Database size={15} color="var(--volume)" />
            <span className="name">块 I/O</span>
            <div style={{ flex: 1, color: 'var(--text-dim)', fontSize: 12 }}>
              读 {fmtBytes(stats.blockRead)} &nbsp;&nbsp; 写 {fmtBytes(stats.blockWrite)}
            </div>
          </div>

          {info && (
            <>
              <div className="section-title">主机信息</div>
              <dl className="detail-grid">
                <dt>名称</dt>
                <dd>{info.name || '-'}</dd>
                <dt>Docker 版本</dt>
                <dd>{info.serverVersion || '-'}</dd>
                <dt>操作系统</dt>
                <dd>{info.os || '-'}</dd>
                <dt>架构</dt>
                <dd>{info.arch || '-'}</dd>
                <dt>CPU</dt>
                <dd>{info.nCPU ?? '-'}</dd>
                <dt>内存</dt>
                <dd>{info.memTotal ? fmtBytes(info.memTotal) : '-'}</dd>
                <dt>存储驱动</dt>
                <dd>{info.driver || '-'}</dd>
              </dl>
            </>
          )}
        </>
      )}

      {!stats && !error && !loading && (
        <div className="empty-state">
          <Box size={32} strokeWidth={1.2} color="var(--text-muted)" />
          <p>暂无统计数据</p>
        </div>
      )}
    </div>
  );
}
