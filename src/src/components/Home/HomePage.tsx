import { useCallback, useState } from 'react';
import { Boxes, Cpu, Images, MemoryStick, Server, Settings, LayoutGrid, Trash2 } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { usePolling } from '../../hooks/usePolling';
import { fmtBytes } from '../../utils/format';
import { CleanupDialog } from '../Images/CleanupDialog';
import type { ConnectionStatus, DockerInfoLite, DockerConnectionConfig } from '../../types/docker';
import pkg from '../../../package.json';
import { t, useT } from '../../i18n';

const KIND_LABEL: Record<DockerConnectionConfig['kind'], string> = {
  tcp: 'TCP',
  ssh: 'SSH',
  unix: 'Unix Socket',
};

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function timeLabel(ts: number) {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

interface RecentEvent {
  id: string;
  hostId: string;
  type: string;
  action: string;
  name?: string;
  time: number;
}

function HostCard({
  conn,
  status,
  liveInfo,
  lastEvent,
}: {
  conn: DockerConnectionConfig;
  status?: ConnectionStatus;
  /** periodically refreshed info — falls back to the connect-time snapshot */
  liveInfo?: DockerInfoLite;
  lastEvent?: RecentEvent;
}) {
  const openHostView = useAppStore((s) => s.openHostView);
  const online = !!status?.connected;
  const info = liveInfo ?? status?.info;

  return (
    <div
      className="stat-card"
      style={{ cursor: 'pointer' }}
      onClick={() => openHostView(conn.id, { kind: 'dashboard', hostId: conn.id, title: conn.name })}
      title={t("打开 {p0} 的标签页", { p0: conn.name })}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Server size={15} color="var(--host)" />
        <strong style={{ color: 'var(--text-bright)' }}>{conn.name}</strong>
        <span className={`host-status-dot ${online ? 'online' : 'offline'}`} style={{ marginLeft: 'auto' }} />
      </div>
      <div className="stat-label">
        {KIND_LABEL[conn.kind]} · {online ? t("已连接 · v{p0}", { p0: info?.serverVersion || '?' }) : status?.error || '未连接'}
      </div>
      {online && info ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 12px', marginTop: 8 }}>
          <span className="stat-sub" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <Boxes size={12} /> {t('容器')}{info.containersRunning ?? 0}/{info.containers ?? 0} 运行
          </span>
          <span className="stat-sub" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <Images size={12} /> {t('镜像')}{info.images ?? 0}
          </span>
          <span className="stat-sub" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <Cpu size={12} /> {info.nCPU ?? '—'} vCPU
          </span>
          <span className="stat-sub" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <MemoryStick size={12} /> {fmtBytes(info.memTotal, '—')}
          </span>
        </div>
      ) : (
        <div className="stat-sub" style={{ marginTop: 8 }}>
          {online ? '' : t('点击卡片建立连接并打开标签页')}
        </div>
      )}
      {online && lastEvent && (
        <div className="stat-sub" style={{ marginTop: 8, borderTop: '1px solid var(--border)', paddingTop: 6 }}>
          最近：{lastEvent.action}
          {lastEvent.name ? ` · ${lastEvent.name}` : ''}
          <span style={{ marginLeft: 6, opacity: 0.7 }}>{timeLabel(lastEvent.time)}</span>
        </div>
      )}
    </div>
  );
}

/** Non-closable home surface: aggregate Docker info + app info. */
export function HomePage({ active = true }: { active?: boolean }) {
  const t = useT();
  const connections = useAppStore((s) => s.connections);
  const statuses = useAppStore((s) => s.statuses);
  const recentEvents = useAppStore((s) => s.recentEvents);
  const openTab = useAppStore((s) => s.openTab);
  /** live info per connected host, refreshed below (status.info is connect-time only) */
  const [liveInfo, setLiveInfo] = useState<Record<string, DockerInfoLite>>({});
  const [cleanupOpen, setCleanupOpen] = useState(false);

  const refresh = useCallback(async () => {
    const connected = useAppStore
      .getState()
      .connections.filter((c) => useAppStore.getState().statuses[c.id]?.connected);
    await Promise.allSettled(
      connected.map(async (conn) => {
        const info = await window.dockerApi.systemInfo(conn.id);
        if (info) setLiveInfo((prev) => ({ ...prev, [conn.id]: info }));
      })
    );
  }, []);

  // keep the overview numbers fresh (15s cadence, pauses while hidden)
  usePolling({ active, intervalMs: 15000, onLoad: refresh });

  const list = connections.filter((c) => !!statuses[c.id]);
  const onlineList = list.filter((c) => statuses[c.id]?.connected);
  const infoOf = (id: string) => liveInfo[id] ?? statuses[id]?.info;
  const sum = (pick: (i: NonNullable<ConnectionStatus['info']>) => number | undefined) =>
    onlineList.reduce((acc, c) => acc + (pick(infoOf(c.id)!) || 0), 0);

  const lastEventOf = (hostId: string) => recentEvents.find((e) => e.hostId === hostId);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('主页')}</h1>
          <p className="page-subtitle">{t('所有 Docker 连接的总览与软件信息；每个连接的页面在它自己的标签页内切换')}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
          <button className="btn ghost" onClick={() => openTab({ id: 'aggregateContainers', title: t('所有容器'), kind: 'aggregateContainers' })}>
            <LayoutGrid size={14} /> 所有容器
          </button>
          <button className="btn ghost" onClick={() => setCleanupOpen(true)} title={t('docker system df + 按需清理')}>
            <Trash2 size={14} /> 磁盘清理
          </button>
          <button className="btn ghost" onClick={() => openTab({ id: 'settings', title: t('设置'), kind: 'settings' })}>
            <Settings size={14} /> 设置
          </button>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
        <div className="stat-card">
          <div className="stat-label">{t('连接')}</div>
          <div className="stat-value">
            {onlineList.length}
            <span style={{ fontSize: 14, color: 'var(--text-muted)' }}> / {list.length}{t('在线')}</span>
          </div>
          <div className="stat-sub">{t('共')}{connections.length}{t('个连接配置')}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">{t('容器（全部主机）')}</div>
          <div className="stat-value">{sum((i) => i.containersRunning)}</div>
          <div className="stat-sub">{t('运行中 / 共')}{sum((i) => i.containers)}{t('个')}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">{t('镜像（全部主机）')}</div>
          <div className="stat-value">{sum((i) => i.images)}</div>
          <div className="stat-sub">{t('所有在线主机合计')}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">{t('vCPU（全部主机）')}</div>
          <div className="stat-value">{sum((i) => i.nCPU)}</div>
          <div className="stat-sub">{t('所有在线主机合计')}</div>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
        {list.map((c) => (
          <HostCard key={c.id} conn={c} status={statuses[c.id]} liveInfo={liveInfo[c.id]} lastEvent={lastEventOf(c.id)} />
        ))}
      </div>
      {list.length === 0 && (
        <div className="empty-state">
          <Server size={36} strokeWidth={1.2} color="var(--text-muted)" />
          <h3>{t('还没有连接')}</h3>
          <p>{t('点击左上角「添加连接」接入第一台 Docker 主机。')}</p>
        </div>
      )}

      <div className="stat-card" style={{ marginTop: 4 }}>
        <div className="stat-label">{t('软件信息')}</div>
        <div className="stat-sub" style={{ fontSize: 12, lineHeight: 1.9 }}>
          <div>
            <strong style={{ color: 'var(--text-bright)' }}>Dockyard</strong>（docker-manager）v{pkg.version}
            {' · '}Electron 桌面端 · 数据仅保存在本机
          </div>
          <div style={{ color: 'var(--text-muted)' }}>
            {t('连接配置与凭据存储于本机配置文件（支持加密）；仪表板、容器、镜像等页面在对应连接自己的标签页内切换。')}
          </div>
        </div>
      </div>
      {cleanupOpen && (
        <CleanupDialog onClose={() => setCleanupOpen(false)} onDone={() => undefined} />
      )}
    </div>
  );
}
