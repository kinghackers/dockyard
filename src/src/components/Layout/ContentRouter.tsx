import { useRef, type ReactNode } from 'react';
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
import { ComposeLogsPage } from '../Compose/ComposeLogsPage';
import { TerminalPage } from '../Containers/TerminalPage';
import { AggregateContainersPage } from '../Containers/AggregateContainersPage';
import { SettingsPage } from '../Settings/SettingsPage';

function renderView(view: OpenTab) {
  if (view.kind === 'dashboard') {
    return <DashboardPage hostId={view.hostId} />;
  }
  if (view.kind === 'aggregateContainers') {
    return <AggregateContainersPage />;
  }
  if (view.kind === 'settings') {
    return <SettingsPage />;
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
    case 'composeLogs':
      return view.projectName ? (
        <ComposeLogsPage hostId={view.hostId} projectName={view.projectName} />
      ) : null;
    case 'terminal':
      // no containerId → SSH host shell
      return <TerminalPage hostId={view.hostId} containerId={view.containerId} />;
    default:
      return null;
  }
}

/** logs/terminal and list surfaces scroll internally — clip the content shell */
const FILL_KINDS = new Set([
  'containers',
  'images',
  'networks',
  'volumes',
  'composeProject',
  'logs',
  'composeLogs',
  'terminal',
]);

function shellClass(kind: OpenTab['kind']) {
  return FILL_KINDS.has(kind) ? 'content fill' : 'content';
}

export function ContentRouter() {
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const mainView = useAppStore((s) => s.mainView);

  const sessionTab = tabs.find((t) => t.id === activeTabId) ?? null;
  const mainActive = !sessionTab;

  // ---- keep-alive surfaces ----
  // Session tabs (logs / terminals) stay mounted but hidden while inactive so
  // streams and scrollback survive tab switches. The dashboard is kept alive
  // too: switching back shows the previous content without a reload, and its
  // polling pauses while it is not the visible surface.
  const lastDashboardRef = useRef<OpenTab | null>(null);
  if (mainView.kind === 'dashboard') lastDashboardRef.current = mainView;
  const dashboardView = mainView.kind === 'dashboard' ? mainView : lastDashboardRef.current;
  const dashboardVisible = mainActive && mainView.kind === 'dashboard';

  const mainKey = `main:${mainView.kind}:${mainView.hostId ?? ''}:${mainView.containerId ?? ''}:${mainView.projectName ?? ''}`;

  const wrap = (key: string, kind: OpenTab['kind'], visible: boolean, node: ReactNode, hostId?: string) => (
    <div key={key} className={shellClass(kind)} style={{ display: visible ? undefined : 'none' }}>
      {hostId ? <HostGuard hostId={hostId}>{node}</HostGuard> : node}
    </div>
  );

  return (
    <>
      {dashboardView &&
        wrap(
          `dash:${dashboardView.hostId ?? 'overview'}`,
          'dashboard',
          dashboardVisible,
          <DashboardPage hostId={dashboardView.hostId} active={dashboardVisible} />,
          dashboardView.hostId
        )}

      {mainView.kind !== 'dashboard' &&
        wrap(mainKey, mainView.kind, mainActive, renderView(mainView), mainView.hostId)}

      {tabs.map((tab) => wrap(tab.id, tab.kind, tab.id === activeTabId, renderView(tab), tab.hostId))}
    </>
  );
}
