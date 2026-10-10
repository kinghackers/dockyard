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
import { usePolling } from '../../hooks/usePolling';
import { loadUiPref } from '../../utils/uiPrefs';
import { t, useT } from '../../i18n';

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
        reason: t('自动重启中（可能是崩溃循环）'),
      });
      continue;
    }
    if (/\(unhealthy\)/i.test(st)) {
      out.push({ id: c.id, name: c.name, level: 'error', reason: t('健康检查失败') });
      continue;
    }
    const ex = st.match(/Exited\s*\((-?\d+)\)/i);
    if (c.state === 'exited' && ex && Number(ex[1]) !== 0) {
      out.push({
        id: c.id,
        name: c.name,
        level: 'warning',
        reason: t("异常退出（退出码 {p0}）", { p0: ex[1] }),
      });
      continue;
    }
    if (/\(health:\s*starting\)/i.test(st) && c.state === 'running') {
      out.push({ id: c.id, name: c.name, level: 'warning', reason: t('健康检查中') });
    }
  }
  return out;
}

const EVENT_LABEL: Record<string, string> = {
  'container.start': t('启动'),
  'container.stop': t('停止'),
  'container.die': t('退出'),
  'container.kill': t('强制终止'),
  'container.restart': t('重启'),
  'container.destroy': t('删除'),
  'container.create': t('创建'),
  'container.pause': t('暂停'),
  'container.unpause': t('恢复'),
  'container.rename': t('重命名'),
  'image.pull': t('拉取镜像'),
  'image.tag': t('镜像打标签'),
  'image.untag': t('取消标签'),
  'image.delete': t('删除镜像'),
  'volume.create': t('创建卷'),
  'volume.destroy': t('删除卷'),
  'network.create': t('创建网络'),
  'network.destroy': t('删除网络'),
};

function fmtEventTime(ts: number) {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Tiny inline-SVG trend line for the rolling stats samples (0-100%). */
function Sparkline({ points, color, height = 38 }: { points: number[]; color: string; height?: number }) {
  if (points.length < 2) {
    return (
      <div style={{ height, fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
        {t('趋势采集中（需至少 2 次采样）…')}
      </div>
    );
  }
  const w = 100;
  const step = w / (points.length - 1);
  const y = (v: number) => height - 2 - (Math.min(Math.max(v, 0), 100) / 100) * (height - 4);
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(2)},${y(p).toFixed(2)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" style={{ width: '100%', height, display: 'block' }}>
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function eventLabel(e: { type: string; action: string }) {
  const known = EVENT_LABEL[`${e.type}.${e.action}`];
  if (known) return known;
  // "health_status: healthy/unhealthy" — 只在状态真正变化时出现
  if (e.action.startsWith('health_status')) {
    if (e.action.endsWith('unhealthy')) return t('转为不健康');
    if (e.action.endsWith('healthy')) return t('转为健康');
    return t('健康状态变更');
  }
  return e.action;
}

export function DashboardPage({ hostId, active = true }: { hostId?: string; active?: boolean }) {
  const t = useT();
  // per-field selectors keep toasts / unrelated store writes from re-rendering the page
  const connections = useAppStore((s) => s.connections);
  const statuses = useAppStore((s) => s.statuses);
  const setRefreshing = useAppStore((s) => s.setRefreshing);
  const containersVersion = useAppStore((s) => s.containersVersion);
  const recentEvents = useAppStore((s) => s.recentEvents);
  const openTab = useAppStore((s) => s.openTab);
  const containersByHost = useAppStore((s) => s.containersByHost);
  const setContainers = useAppStore((s) => s.setContainers);
  const pushStatsPoint = useAppStore((s) => s.pushStatsPoint);
  const statsHistory = useAppStore((s) => s.statsHistory);
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [info, setInfo] = useState<DockerInfoLite | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef(false);
  const failCount = useRef(0);
  // false while another surface is showing (keep-alive) — event-driven reloads
  // pause while inactive; usePolling performs the catch-up on reactivation
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
      pushStatsPoint(targetHost, s.cpuPercent, s.memPercent);
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

  // configurable cadence (settings.pollIntervalMs, 0 = off) with linear backoff
  // while the daemon is unreachable; frozen while hidden — no catch-up reload
  // on reactivation, the previous content stays until the next live tick or a
  // manual refresh
  usePolling({
    active,
    reloadKey: targetHost,
    catchUp: false,
    intervalMs: () => {
      const base = loadUiPref('settings.pollIntervalMs', 10000);
      if (base <= 0) return 0;
      return failCount.current > 0 ? Math.min(base * failCount.current, 60000) : base;
    },
    onLoad: load,
  });

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
          <h3>{t('尚未连接任何 Docker 主机')}</h3>
          <p>{t('请在左侧添加并连接一个远程 Docker 服务')}</p>
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
          {t('仪表板')} · {conn?.name || targetHost}
        </div>
        <div className="page-subtitle">
          {info?.serverVersion ? `Docker ${info.serverVersion}` : ''}
          {info?.os ? ` · ${info.os}` : ''}
          {info?.arch ? ` · ${info.arch}` : ''}
          <span style={{ marginLeft: 10, opacity: 0.65 }}>{formatBuildLabel()}</span>
        </div>
        <div style={{ flex: 1 }} />
        <button className="btn" onClick={load} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'spinner' : ''} /> {t('刷新')}
        </button>
      </div>

      {error && (
        <div className="alert danger" style={{ marginBottom: 16 }}>
          {error}
          {!status?.connected && <div style={{ marginTop: 6, fontSize: 11 }}>{t('请先在左侧连接该主机')}</div>}
        </div>
      )}

      {stats && (
        <>
          <div className="stat-grid">
            <div className="stat-card">
              <div className="stat-label">{t('运行中容器')}</div>
              <div className="stat-value">{stats.containersRunning}</div>
              <div className="stat-sub">{t('共')} {stats.containersTotal} {t('个')}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">{t('镜像')}</div>
              <div className="stat-value">{stats.images}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">{t('网络')}</div>
              <div className="stat-value">{stats.networks}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">{t('数据卷')}</div>
              <div className="stat-value">{stats.volumes}</div>
            </div>
            <div
              className="stat-card"
              style={problems.length > 0 ? { border: '1px solid var(--error-border)' } : undefined}
            >
              <div className="stat-label">{t('异常')}</div>
              <div
                className="stat-value"
                style={{ color: problems.length > 0 ? 'var(--error)' : 'var(--success)' }}
              >
                {problems.length}
              </div>
              <div className="stat-sub">{problems.length > 0 ? t('需要关注') : t('状态正常')}</div>
            </div>
          </div>

          <div className="section-title">{t('排障速览')}</div>
          {problems.length === 0 ? (
            <div
              style={{
                padding: '10px 12px',
                borderRadius: 4,
                background: 'var(--success-soft)',
                border: '1px solid var(--success-border)',
                color: 'var(--success)',
                fontSize: 12,
                marginBottom: 8,
              }}
            >
              {t('当前没有检测到重启循环、健康检查失败或异常退出的容器。')}
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
                      p.level === 'error' ? 'var(--error-border)' : 'var(--warn-border)'
                    }`,
                    background:
                      p.level === 'error' ? 'var(--error-soft)' : 'var(--warn-soft)',
                  }}
                  onClick={() =>
                    openTab({
                      id: `containerDetail:${targetHost}:${p.id}`,
                      title: t("容器: {p0}", { p0: p.name }),
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
                  <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{t('查看详情 ›')}</span>
                </div>
              ))}
            </div>
          )}

          <div className="section-title">{t('资源占用')}</div>

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
            <span className="name">{t('内存')}</span>
            <div className={meterClass(stats.memPercent)}>
              <span style={{ width: `${Math.min(stats.memPercent, 100)}%` }} />
            </div>
            <span className="value">
              {fmtBytes(stats.memUsage)} / {fmtBytes(stats.memLimit)}
            </span>
          </div>

          <div className="resource-row">
            <Network size={15} color="var(--network)" />
            <span className="name">{t('网络 I/O')}</span>
            <div style={{ flex: 1, color: 'var(--text-dim)', fontSize: 12 }}>
              ↓ {fmtBytes(stats.netRx)} &nbsp;&nbsp; ↑ {fmtBytes(stats.netTx)}
            </div>
          </div>

          <div className="resource-row">
            <Database size={15} color="var(--volume)" />
            <span className="name">{t('块 I/O')}</span>
            <div style={{ flex: 1, color: 'var(--text-dim)', fontSize: 12 }}>
              {t('读')} {fmtBytes(stats.blockRead)} &nbsp;&nbsp; {t('写')} {fmtBytes(stats.blockWrite)}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 14, marginTop: 12, flexWrap: 'wrap' }}>
            {(() => {
              const hist = statsHistory[targetHost] || [];
              const card = (label: string, color: string, pts: number[]) => (
                <div
                  style={{
                    flex: 1,
                    minWidth: 240,
                    border: '1px solid var(--border)',
                    borderRadius: 4,
                    padding: '8px 10px 6px',
                  }}
                >
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 2 }}>
                    <span style={{ color }}>●</span> {label}
                    <span style={{ float: 'right' }}>{t('近')} {hist.length} {t('次采样')}</span>
                  </div>
                  <Sparkline points={pts} color={color} />
                </div>
              );
              return (
                <>
                  {card(t('CPU 趋势'), 'var(--accent)', hist.map((p) => p.cpu))}
                  {card(t('内存趋势'), 'var(--success)', hist.map((p) => p.mem))}
                </>
              );
            })()}
          </div>

          <div className="section-title">
            <Radio size={13} style={{ marginRight: 6, verticalAlign: -2 }} />
            {t('最近事件')}
          </div>
          {hostEvents.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
              {t('暂无事件。启动/停止容器后这里会滚动显示。')}
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
              <div className="section-title">{t('主机信息')}</div>
              <dl className="detail-grid">
                <dt>{t('名称')}</dt>
                <dd>{info.name || '-'}</dd>
                <dt>{t('Docker 版本')}</dt>
                <dd>{info.serverVersion || '-'}</dd>
                <dt>{t('操作系统')}</dt>
                <dd>{info.os || '-'}</dd>
                <dt>{t('架构')}</dt>
                <dd>{info.arch || '-'}</dd>
                <dt>CPU</dt>
                <dd>{info.nCPU ?? '-'}</dd>
                <dt>{t('内存')}</dt>
                <dd>{info.memTotal ? fmtBytes(info.memTotal) : '-'}</dd>
                <dt>{t('存储驱动')}</dt>
                <dd>{info.driver || '-'}</dd>
              </dl>
            </>
          )}
        </>
      )}

      {!stats && !error && !loading && (
        <div className="empty-state">
          <Box size={32} strokeWidth={1.2} color="var(--text-muted)" />
          <p>{t('暂无统计数据')}</p>
        </div>
      )}
    </div>
  );
}
