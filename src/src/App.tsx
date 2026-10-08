import { useEffect, useCallback, useState, useRef } from 'react';
import { Sidebar } from './components/Sidebar/Sidebar';
import { TabBar } from './components/Layout/TabBar';
import { ContentRouter } from './components/Layout/ContentRouter';
import { StatusBar } from './components/Layout/StatusBar';
import { ConnectionDialog } from './components/Connection/ConnectionDialog';
import { Toasts } from './components/common/Toasts';
import { CommandPalette } from './components/common/CommandPalette';
import { useAppStore } from './stores/appStore';
import { useDockerEvents } from './utils/useDockerEvents';
import { loadUiPref, saveUiPref } from './utils/uiPrefs';
import type { DockerConnectionConfig } from './types/docker';

export default function App() {
  // actions only — subscribing to data here would re-render the whole tree
  // on every store change (toasts, events, container lists)
  const setConnections = useAppStore((s) => s.setConnections);
  const setGroups = useAppStore((s) => s.setGroups);
  const setAllStatuses = useAppStore((s) => s.setAllStatuses);
  const setMainView = useAppStore((s) => s.setMainView);
  const toast = useAppStore((s) => s.toast);

  const [connDialogOpen, setConnDialogOpen] = useState(false);
  const [editingConn, setEditingConn] = useState<DockerConnectionConfig | null>(null);
  const [defaultGroupId, setDefaultGroupId] = useState<string | undefined>(undefined);
  const healthWarned = useRef(false);

  // live auto-refresh via docker events
  useDockerEvents();

  const loadConnections = useCallback(async () => {
    try {
      const list = await window.dockerApi.listConnections();
      setConnections(list);
      const groups = await window.dockerApi.listGroups();
      setGroups(groups);
      const st = await window.dockerApi.listStatuses();
      setAllStatuses(st);

      // one-time startup warnings: corrupt config backup / plaintext secrets
      if (!healthWarned.current) {
        healthWarned.current = true;
        try {
          const health = await window.dockerApi.configHealth();
          if (health.loadError) {
            toast(health.loadError, 'error');
          } else if (
            !health.encryptionAvailable &&
            list.some((c) => c.sshPassword || c.sshPassphrase || c.key || c.cert)
          ) {
            toast('系统加密存储不可用，SSH/TLS 凭据将以明文保存在本机配置文件中', 'info');
          }
        } catch {
          /* health check is best-effort */
        }
      }
    } catch (e) {
      console.error(e);
    }
  }, [setConnections, setGroups, setAllStatuses, toast]);

  useEffect(() => {
    void loadConnections();
    // default primary surface
    setMainView({ title: '仪表板', kind: 'dashboard' });
    // restore sidebar width and theme across sessions
    const w = loadUiPref<number | null>('sidebar.width', null);
    if (typeof w === 'number' && w >= 220 && w <= 480) {
      document.documentElement.style.setProperty('--sidebar-width', `${w}px`);
    }
    if (loadUiPref<'dark' | 'light'>('settings.theme', 'dark') === 'light') {
      document.documentElement.dataset.theme = 'light';
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startSidebarResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const clamp = (x: number) => Math.min(480, Math.max(220, x));
    const onMove = (ev: MouseEvent) => {
      document.documentElement.style.setProperty('--sidebar-width', `${clamp(ev.clientX)}px`);
    };
    const onUp = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      saveUiPref('sidebar.width', clamp(ev.clientX));
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handleAddConnection = (groupId?: string) => {
    setEditingConn(null);
    setDefaultGroupId(groupId);
    setConnDialogOpen(true);
  };

  const handleEditConnection = (cfg: DockerConnectionConfig) => {
    setEditingConn(cfg);
    setDefaultGroupId(undefined);
    setConnDialogOpen(true);
  };

  const handleConnect = async (id: string) => {
    try {
      const status = await window.dockerApi.connect(id);
      useAppStore.getState().setStatus(status);
      if (status.connected) {
        const name = useAppStore.getState().connections.find((c) => c.id === id)?.name || id;
        toast(`已连接 ${name}`, 'success');
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
        <div className="sidebar-resizer" onMouseDown={startSidebarResize} />
        <div className="main-area">
          <TabBar />
          <ContentRouter />
        </div>
      </div>
      <StatusBar />
      <CommandPalette />
      {connDialogOpen && (
        <ConnectionDialog
          initial={editingConn}
          defaultGroupId={defaultGroupId}
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
