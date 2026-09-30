import { useEffect, useCallback, useState } from 'react';
import { Sidebar } from './components/Sidebar/Sidebar';
import { TabBar } from './components/Layout/TabBar';
import { ContentRouter } from './components/Layout/ContentRouter';
import { StatusBar } from './components/Layout/StatusBar';
import { ConnectionDialog } from './components/Connection/ConnectionDialog';
import { Toasts } from './components/common/Toasts';
import { useAppStore } from './stores/appStore';
import { useDockerEvents } from './utils/useDockerEvents';
import type { DockerConnectionConfig } from './types/docker';

export default function App() {
  const {
    setConnections,
    setAllStatuses,
    setMainView,
    toast,
    connections,
    statuses,
  } = useAppStore();

  const [connDialogOpen, setConnDialogOpen] = useState(false);
  const [editingConn, setEditingConn] = useState<DockerConnectionConfig | null>(null);

  // live auto-refresh via docker events
  useDockerEvents();

  const loadConnections = useCallback(async () => {
    try {
      const list = await window.dockerApi.listConnections();
      setConnections(list);
      const st = await window.dockerApi.listStatuses();
      setAllStatuses(st);
    } catch (e) {
      console.error(e);
    }
  }, [setConnections, setAllStatuses]);

  useEffect(() => {
    void loadConnections();
    // default primary surface
    setMainView({ title: '仪表板', kind: 'dashboard' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAddConnection = () => {
    setEditingConn(null);
    setConnDialogOpen(true);
  };

  const handleEditConnection = (cfg: DockerConnectionConfig) => {
    setEditingConn(cfg);
    setConnDialogOpen(true);
  };

  const handleConnect = async (id: string) => {
    try {
      const status = await window.dockerApi.connect(id);
      useAppStore.getState().setStatus(status);
      if (status.connected) {
        toast(`已连接 ${connections.find((c) => c.id === id)?.name || id}`, 'success');
      } else {
        toast(status.error || '连接失败', 'error');
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  const handleDisconnect = async (id: string) => {
    try {
      await window.dockerApi.disconnect(id);
      useAppStore.getState().setStatus({ id, connected: false });
      toast('已断开连接', 'info');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  return (
    <div className="app">
      <div className="app-body">
        <Sidebar
          onAddConnection={handleAddConnection}
          onEditConnection={handleEditConnection}
          onConnect={handleConnect}
          onDisconnect={handleDisconnect}
        />
        <div className="main-area">
          <TabBar />
          <ContentRouter />
        </div>
      </div>
      <StatusBar />
      {connDialogOpen && (
        <ConnectionDialog
          initial={editingConn}
          onClose={() => setConnDialogOpen(false)}
          onSaved={async () => {
            setConnDialogOpen(false);
            await loadConnections();
            toast('连接配置已保存', 'success');
          }}
        />
      )}
      <Toasts />
    </div>
  );
}
