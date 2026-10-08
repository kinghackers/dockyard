import { Boxes, Cpu, Images, MemoryStick, Server, Settings, LayoutGrid } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import type { ConnectionStatus, DockerConnectionConfig } from '../../types/docker';
import pkg from '../../../package.json';

function formatBytes(n?: number): string {
  if (!n || n <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

const KIND_LABEL: Record<DockerConnectionConfig['kind'], string> = {
  tcp: 'TCP',
  ssh: 'SSH',
  unix: 'Unix Socket',
};

function HostCard({ conn, status }: { conn: DockerConnectionConfig; status?: ConnectionStatus }) {
  const openHostView = useAppStore((s) => s.openHostView);
  const online = !!status?.connected;
  const info = status?.info;

  return (
    <div
      className="stat-card"
      style={{ cursor: 'pointer' }}
      onClick={() => openHostView(conn.id, { kind: 'dashboard', hostId: conn.id, title: conn.name })}
      title={`打开 ${conn.name} 的标签页`}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Server size={15} color="var(--host)" />
        <strong style={{ color: 'var(--text-bright)' }}>{conn.name}</strong>
        <span className={`host-status-dot ${online ? 'online' : 'offline'}`} style={{ marginLeft: 'auto' }} />
      </div>
      <div className="stat-label">
        {KIND_LABEL[conn.kind]} · {online ? `已连接 · v${info?.serverVersion || '?'}` : status?.error || '未连接'}
      </div>
      {online && info ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 12px', marginTop: 8 }}>
          <span className="stat-sub" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <Boxes size={12} /> 容器 {info.containersRunning ?? 0}/{info.containers ?? 0} 运行
          </span>
          <span className="stat-sub" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <Images size={12} /> 镜像 {info.images ?? 0}
          </span>
          <span className="stat-sub" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <Cpu size={12} /> {info.nCPU ?? '—'} vCPU
          </span>
          <span className="stat-sub" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <MemoryStick size={12} /> {formatBytes(info.memTotal)}
          </span>
        </div>
      ) : (
        <div className="stat-sub" style={{ marginTop: 8 }}>
          {online ? '' : '点击卡片建立连接并打开标签页'}
        </div>
      )}
    </div>
  );
}

/** Non-closable home surface: aggregate Docker info + app info. */
export function HomePage() {
  const connections = useAppStore((s) => s.connections);
  const statuses = useAppStore((s) => s.statuses);
  const openTab = useAppStore((s) => s.openTab);

  const list = connections.filter((c) => !!statuses[c.id]);
  const onlineList = list.filter((c) => statuses[c.id]?.connected);
  const sum = (pick: (i: NonNullable<ConnectionStatus['info']>) => number | undefined) =>
    onlineList.reduce((acc, c) => acc + (pick(statuses[c.id]?.info!) || 0), 0);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">主页</h1>
          <p className="page-subtitle">所有 Docker 连接的总览与软件信息；每个连接的页面在它自己的标签页内切换</p>
        </div>
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
          <button className="btn ghost" onClick={() => openTab({ id: 'aggregateContainers', title: '所有容器', kind: 'aggregateContainers' })}>
            <LayoutGrid size={14} /> 所有容器
          </button>
          <button className="btn ghost" onClick={() => openTab({ id: 'settings', title: '设置', kind: 'settings' })}>
            <Settings size={14} /> 设置
          </button>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
        <div className="stat-card">
          <div className="stat-label">连接</div>
          <div className="stat-value">
            {onlineList.length}
            <span style={{ fontSize: 14, color: 'var(--text-muted)' }}> / {list.length} 在线</span>
          </div>
          <div className="stat-sub">共 {connections.length} 个连接配置</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">容器（全部主机）</div>
          <div className="stat-value">{sum((i) => i.containersRunning)}</div>
          <div className="stat-sub">运行中 / 共 {sum((i) => i.containers)} 个</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">镜像（全部主机）</div>
          <div className="stat-value">{sum((i) => i.images)}</div>
          <div className="stat-sub">所有在线主机合计</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">vCPU（全部主机）</div>
          <div className="stat-value">{sum((i) => i.nCPU)}</div>
          <div className="stat-sub">所有在线主机合计</div>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
        {list.map((c) => (
          <HostCard key={c.id} conn={c} status={statuses[c.id]} />
        ))}
      </div>
      {list.length === 0 && (
        <div className="empty-state">
          <Server size={36} strokeWidth={1.2} color="var(--text-muted)" />
          <h3>还没有连接</h3>
          <p>点击左上角「添加连接」接入第一台 Docker 主机。</p>
        </div>
      )}

      <div className="stat-card" style={{ marginTop: 4 }}>
        <div className="stat-label">软件信息</div>
        <div className="stat-sub" style={{ fontSize: 12, lineHeight: 1.9 }}>
          <div>
            <strong style={{ color: 'var(--text-bright)' }}>Dockyard</strong>（docker-manager）v{pkg.version}
            {' · '}Electron 桌面端 · 数据仅保存在本机
          </div>
          <div style={{ color: 'var(--text-muted)' }}>
            连接配置与凭据存储于本机配置文件（支持加密）；仪表板、容器、镜像等页面在对应连接自己的标签页内切换。
          </div>
        </div>
      </div>
    </div>
  );
}
