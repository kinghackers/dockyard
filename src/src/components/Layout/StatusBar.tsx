import { useAppStore } from '../../stores/appStore';
import { formatBuildLabel } from '../../utils/buildInfo';

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
      <span style={{ opacity: 0.7 }}>Ctrl+F 搜索 · F5 刷新 · Ctrl+A 全选 · Del 删除</span>
      <span style={{ opacity: 0.55, marginLeft: 12 }} title="版本与构建时间">
        {formatBuildLabel()}
      </span>
    </div>
  );
}
