import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  RefreshCw,
  Cpu,
  HardDrive,
  Network,
  Box,
  Database,
  Activity,
  AlertTriangle,
  Radio,
} from 'lucide-react';
import type { ConnectionStatus, SystemStats, DockerInfoLite, ContainerSummary } from '../../types/docker';
import { useAppStore } from '../../stores/appStore';
import { formatBuildLabel } from '../../utils/buildInfo';

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

type Problem = {
  id: string;
  name: string;
  level: 'error' | 'warning';
  reason: string;
};

function detectProblems(list: ContainerSummary[]): Problem[] {
  const out: Problem[] = [];
  for (const c of list) {
    const st = c.status || '';
    if (c.state === 'restarting' || /^restarting\b/i.test(st)) {
      out.push({
        id: c.id,
        name: c.name,
        level: 'error',
        reason: '自动重启中（可能是崩溃循环）',
      });
      continue;
    }
    if (/\(unhealthy\)/i.test(st)) {
      out.push({ id: c.id, name: c.name, level: 'error', reason: '健康检查失败' });
      continue;
    }
    const ex = st.match(/Exited\s*\((-?\d+)\)/i);
    if (c.state === 'exited' && ex && Number(ex[1]) !== 0) {
      out.push({
        id: c.id,
        name: c.name,
        level: 'warning',
        reason: `异常退出（退出码 ${ex[1]}）`,
      });
      continue;
    }
    if (/\(health:\s*starting\)/i.test(st) && c.state === 'running') {
      out.push({ id: c.id, name: c.name, level: 'warning', reason: '健康检查中' });
    }
  }
  return out;
}

const EVENT_LABEL: Record<string, string> = {
  'container.start': '启动',
  'container.stop': '停止',
  'container.die': '退出',
  'container.kill': '强制终止',
  'container.restart': '重启',
  'container.destroy': '删除',
  'container.create': '创建',
  'container.pause': '暂停',
  'container.unpause': '恢复',
  'container.rename': '重命名',
  'image.pull': '拉取镜像',
  'image.tag': '镜像打标签',
  'image.untag': '取消标签',
  'image.delete': '删除镜像',
  'volume.create': '创建卷',
  'volume.destroy': '删除卷',
  'network.create': '创建网络',
  'network.destroy': '删除网络',
};

function fmtEventTime(ts: number) {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function eventLabel(e: { type: string; action: string }) {
  const known = EVENT_LABEL[`${e.type}.${e.action}`];
  if (known) return known;
  // "health_status: healthy/unhealthy" — 只在状态真正变化时出现
  if (e.action.startsWith('health_status')) {
    if (e.action.endsWith('unhealthy')) return '转为不健康';
    if (e.action.endsWith('healthy')) return '转为健康';
    return '健康状态变更';
  }
  return e.action;
}

export function DashboardPage({ hostId, active = true }: { hostId?: string; active?: boolean }) {
  // per-field selectors keep toasts / unrelated store writes from re-rendering the page
  const connections = useAppStore((s) => s.connections);
  const statuses = useAppStore((s) => s.statuses);
  const setRefreshing = useAppStore((s) => s.setRefreshing);
  const containersVersion = useAppStore((s) => s.containersVersion);
  const recentEvents = useAppStore((s) => s.recentEvents);
  const openTab = useAppStore((s) => s.openTab);
  const containersByHost = useAppStore((s) => s.containersByHost);
  const setContainers = useAppStore((s) => s.setContainers);
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [info, setInfo] = useState<DockerInfoLite | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef(false);
  const failCount = useRef(0);
  // false while another surface is showing (keep-alive) — all loads freeze
  // then, and there is no catch-up reload on reactivation: the previous
  // content stays until the next live tick or a manual refresh
  const activeRef = useRef(active);
  activeRef.current = active;

  const targetHost = hostId || connections.find((c) => statuses[c.id]?.connected)?.id;

  const load = useCallback(async () => {
    if (!targetHost || inflight.current) return;
    inflight.current = true;
    setLoading(true);
    setRefreshing(true);
    setError(null);
    try {
      const [s, i, list] = await Promise.all([
        window.dockerApi.systemStats(targetHost),
        window.dockerApi.systemInfo(targetHost),
        window.dockerApi.listContainers(targetHost, true),
      ]);
      setStats(s);
      setInfo(i);
      setContainers(targetHost, list);
      failCount.current = 0;
    } catch (e) {
      failCount.current += 1;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      inflight.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, [targetHost, setRefreshing, setContainers]);

  useEffect(() => {
    void load();
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      if (stopped) return;
      // skip while minimized or hidden behind another surface — content stays
      // frozen until the dashboard is the visible surface again
      if (activeRef.current && !document.hidden) {
        await load();
      }
      const delay = failCount.current > 0 ? Math.min(10000 * failCount.current, 60000) : 10000;
      timer = setTimeout(() => void tick(), delay);
    };
    void tick();
    // no catch-up load on regain — normal tick cadence resumes on its own
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [load]);

  useEffect(() => {
    if (containersVersion > 0 && activeRef.current) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containersVersion]);

  const containers = useMemo(
    () => (targetHost ? containersByHost[targetHost] || [] : []),
    [containersByHost, targetHost]
  );
  const problems = useMemo(() => detectProblems(containers), [containers]);
  const hostEvents = useMemo(
    () => recentEvents.filter((e) => !targetHost || e.hostId === targetHost).slice(0, 12),
    [recentEvents, targetHost]
  );

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
          <span style={{ marginLeft: 10, opacity: 0.65 }}>{formatBuildLabel()}</span>
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
            <div
              className="stat-card"
              style={problems.length > 0 ? { border: '1px solid rgba(207,91,86,0.45)' } : undefined}
            >
              <div className="stat-label">异常</div>
              <div
                className="stat-value"
                style={{ color: problems.length > 0 ? 'var(--error)' : 'var(--success)' }}
              >
                {problems.length}
              </div>
              <div className="stat-sub">{problems.length > 0 ? '需要关注' : '状态正常'}</div>
            </div>
          </div>

          <div className="section-title">排障速览</div>
          {problems.length === 0 ? (
            <div
              style={{
                padding: '10px 12px',
                borderRadius: 4,
                background: 'rgba(89,168,105,0.1)',
                border: '1px solid rgba(89,168,105,0.25)',
                color: 'var(--success)',
                fontSize: 12,
                marginBottom: 8,
              }}
            >
              当前没有检测到重启循环、健康检查失败或异常退出的容器。
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
              {problems.map((p) => (
                <div
                  key={p.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 12px',
                    borderRadius: 4,
                    cursor: 'pointer',
                    border: `1px solid ${
                      p.level === 'error' ? 'rgba(207,91,86,0.35)' : 'rgba(217,164,6,0.35)'
                    }`,
                    background:
                      p.level === 'error' ? 'rgba(207,91,86,0.1)' : 'rgba(217,164,6,0.1)',
                  }}
                  onClick={() =>
                    openTab({
                      id: `containerDetail:${targetHost}:${p.id}`,
                      title: `容器: ${p.name}`,
                      kind: 'containerDetail',
                      hostId: targetHost,
                      containerId: p.id,
                    })
                  }
                >
                  <AlertTriangle
                    size={14}
                    color={p.level === 'error' ? 'var(--error)' : 'var(--warning)'}
                  />
                  <span style={{ color: 'var(--text-bright)', fontWeight: 500, minWidth: 120 }}>
                    {p.name}
                  </span>
                  <span style={{ flex: 1, fontSize: 12, color: 'var(--text)' }}>{p.reason}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>查看详情 ›</span>
                </div>
              ))}
            </div>
          )}

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

          <div className="section-title">
            <Radio size={13} style={{ marginRight: 6, verticalAlign: -2 }} />
            最近事件
          </div>
          {hostEvents.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
              暂无事件。启动/停止容器后这里会滚动显示。
            </div>
          ) : (
            <div
              style={{
                border: '1px solid var(--border)',
                borderRadius: 4,
                overflow: 'hidden',
                marginBottom: 16,
              }}
            >
              {hostEvents.map((e) => {
                const label = eventLabel(e);
                return (
                  <div
                    key={e.id}
                    style={{
                      display: 'flex',
                      gap: 10,
                      padding: '6px 12px',
                      fontSize: 12,
                      borderBottom: '1px solid var(--border)',
                      color: 'var(--text)',
                    }}
                  >
                    <span className="mono" style={{ color: 'var(--text-muted)', width: 64 }}>
                      {fmtEventTime(e.time)}
                    </span>
                    <span style={{ color: 'var(--text-bright)', minWidth: 72 }}>
                      {label}
                    </span>
                    <span style={{ flex: 1, color: 'var(--text-dim)' }}>{e.name || e.type}</span>
                  </div>
                );
              })}
            </div>
          )}

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
