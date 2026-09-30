import { useAppStore } from '../../stores/appStore';
import type { OpenTab } from '../../types/docker';
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

function renderView(view: OpenTab) {
  if (view.kind === 'dashboard') {
    return <DashboardPage hostId={view.hostId} />;
  }
  if (!view.hostId) return null;

  switch (view.kind) {
    case 'containers':
      return <ContainerListPage hostId={view.hostId} />;
    case 'containerDetail':
      return view.containerId ? (
        <ContainerDetailPage hostId={view.hostId} containerId={view.containerId} />
      ) : null;
    case 'images':
      return <ImageListPage hostId={view.hostId} />;
    case 'networks':
      return <NetworkListPage hostId={view.hostId} />;
    case 'volumes':
      return <VolumeListPage hostId={view.hostId} />;
    case 'compose':
      return <ComposeListPage hostId={view.hostId} />;
    case 'composeProject':
      return view.projectName ? (
        <ComposeProjectPage hostId={view.hostId} projectName={view.projectName} />
      ) : null;
    case 'logs':
      return view.containerId ? (
        <LogViewerPage hostId={view.hostId} containerId={view.containerId} />
      ) : null;
    case 'terminal':
      return view.containerId ? (
        <TerminalPage hostId={view.hostId} containerId={view.containerId} />
      ) : null;
    default:
      return null;
  }
}

export function ContentRouter() {
  const { tabs, activeTabId, mainView } = useAppStore();

  // Session tab (logs/terminal) wins when active; otherwise the primary surface.
  const sessionTab = tabs.find((t) => t.id === activeTabId);
  const view: OpenTab = sessionTab ?? mainView;

  // key forces a remount when the tree switches the primary surface → fresh data
  const contentKey = sessionTab
    ? sessionTab.id
    : `main:${view.kind}:${view.hostId ?? ''}:${view.containerId ?? ''}:${view.projectName ?? ''}`;

  const body = renderView(view);

  if (view.hostId) {
    return (
      <div className="content" key={contentKey}>
        <HostGuard hostId={view.hostId}>{body}</HostGuard>
      </div>
    );
  }

  return (
    <div className="content" key={contentKey}>
      {body}
    </div>
  );
}
