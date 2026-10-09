import { Fragment, type ReactNode } from 'react';
import { useAppStore } from '../../stores/appStore';
import type { OpenTab } from '../../types/docker';
import { HostGuard } from '../common/HostGuard';
import { HomePage } from '../Home/HomePage';
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

function renderView(view: OpenTab, active = true) {
  if (view.kind === 'home') {
    return <HomePage active={active} />;
  }
  if (view.kind === 'dashboard') {
    return <DashboardPage hostId={view.hostId} active={active} />;
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
  const hostViews = useAppStore((s) => s.hostViews);

  const sessionTab = tabs.find((t) => t.id === activeTabId) ?? null;
  const mainActive = !sessionTab;

  const mainKey = `main:${mainView.kind}:${mainView.hostId ?? ''}:${mainView.containerId ?? ''}:${mainView.projectName ?? ''}`;

  const wrap = (key: string, kind: OpenTab['kind'], visible: boolean, node: ReactNode, hostId?: string) => (
    <div key={key} className={shellClass(kind)} style={{ display: visible ? undefined : 'none' }}>
      {hostId ? <HostGuard hostId={hostId}>{node}</HostGuard> : node}
    </div>
  );

  return (
    <>
      {wrap(mainKey, mainView.kind, mainActive, renderView(mainView, mainActive), mainView.hostId)}

      {tabs.map((tab) => {
        // host tab: the page shown inside comes from hostViews (default: dashboard)
        if (tab.kind === 'dashboard' && tab.hostId) {
          const inner = hostViews[tab.hostId] ?? { ...tab, closable: false };
          const tabActive = tab.id === activeTabId;
          const dashVisible = tabActive && inner.kind === 'dashboard';
          return (
            <Fragment key={tab.id}>
              {/* keep the host dashboard mounted while other host pages show:
                  returning to it keeps the previous content (no reload) */}
              {wrap(
                `dash:${tab.hostId}`,
                'dashboard',
                dashVisible,
                <DashboardPage hostId={tab.hostId} active={dashVisible} />,
                tab.hostId
              )}
              {inner.kind !== 'dashboard' &&
                wrap(tab.id, inner.kind, tabActive, renderView(inner, tabActive), tab.hostId)}
            </Fragment>
          );
        }
        return wrap(tab.id, tab.kind, tab.id === activeTabId, renderView(tab, tab.id === activeTabId), tab.hostId);
      })}
    </>
  );
}
