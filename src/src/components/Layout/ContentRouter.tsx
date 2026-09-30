import { useAppStore } from '../../stores/appStore';
import { HostGuard } from '../common/HostGuard';
import { DashboardPage } from '../Dashboard/DashboardPage';
import { ContainerListPage } from '../Containers/ContainerListPage';
import { ContainerDetailPage } from '../Containers/ContainerDetailPage';
import { ImageListPage } from '../Images/ImageListPage';
import { NetworkListPage } from '../Networks/NetworkListPage';
import { VolumeListPage } from '../Volumes/VolumeListPage';
import { ComposeListPage } from '../Compose/ComposeListPage';
import { ComposeProjectPage } from '../Compose/ComposeProjectPage';
import { LogViewerPage } from '../Containers/LogViewerPage';
import { TerminalPage } from '../Containers/TerminalPage';

export function ContentRouter() {
  const { tabs, activeTabId } = useAppStore();
  const tab = tabs.find((t) => t.id === activeTabId);

  if (!tab) {
    return (
      <div className="content">
        <div className="empty-state">
          <h3>IDEA Docker 管理器</h3>
          <p>从左侧选择一个 Docker 主机或资源开始管理</p>
        </div>
      </div>
    );
  }

  const body = (() => {
    if (tab.kind === 'dashboard') {
      return <DashboardPage hostId={tab.hostId} />;
    }
    if (!tab.hostId) return null;

    switch (tab.kind) {
      case 'containers':
        return <ContainerListPage hostId={tab.hostId} />;
      case 'containerDetail':
        return tab.containerId ? (
          <ContainerDetailPage hostId={tab.hostId} containerId={tab.containerId} />
        ) : null;
      case 'images':
        return <ImageListPage hostId={tab.hostId} />;
      case 'networks':
        return <NetworkListPage hostId={tab.hostId} />;
      case 'volumes':
        return <VolumeListPage hostId={tab.hostId} />;
      case 'compose':
        return <ComposeListPage hostId={tab.hostId} />;
      case 'composeProject':
        return tab.projectName ? (
          <ComposeProjectPage hostId={tab.hostId} projectName={tab.projectName} />
        ) : null;
      case 'logs':
        return tab.containerId ? (
          <LogViewerPage hostId={tab.hostId} containerId={tab.containerId} />
        ) : null;
      case 'terminal':
        return tab.containerId ? (
          <TerminalPage hostId={tab.hostId} containerId={tab.containerId} />
        ) : null;
      default:
        return null;
    }
  })();

  // Host-scoped views require a live connection; guard prevents IPC error spam.
  if (tab.hostId) {
    return (
      <div className="content" key={tab.id}>
        <HostGuard hostId={tab.hostId}>{body}</HostGuard>
      </div>
    );
  }

  return (
    <div className="content" key={tab.id}>
      {body}
    </div>
  );
}
