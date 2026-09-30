import { useAppStore } from '../../stores/appStore';

export function StatusBar() {
  const { connections, statuses, refreshing } = useAppStore();
  const online = connections.filter((c) => statuses[c.id]?.connected).length;

  return (
    <div className="status-bar">
      <span>
        连接: {online}/{connections.length}
      </span>
      {refreshing && <span className="spinner" style={{ width: 10, height: 10 }} />}
      <div style={{ flex: 1 }} />
      <span>Docker 管理器</span>
    </div>
  );
}
