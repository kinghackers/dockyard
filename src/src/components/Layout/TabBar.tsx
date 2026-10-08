import { X, LayoutDashboard, Boxes, Image, Network, Database, Layers, FileText, Terminal as Term } from 'lucide-react';
import { useAppStore, MAIN_VIEW_ID } from '../../stores/appStore';
import type { ViewKind } from '../../types/docker';

const kindIcon: Record<ViewKind, React.ReactNode> = {
  dashboard: <LayoutDashboard size={13} />,
  containers: <Boxes size={13} />,
  images: <Image size={13} />,
  networks: <Network size={13} />,
  volumes: <Database size={13} />,
  compose: <Layers size={13} />,
  composeProject: <Layers size={13} />,
  containerDetail: <Boxes size={13} />,
  logs: <FileText size={13} />,
  composeLogs: <FileText size={13} />,
  terminal: <Term size={13} />,
};

export function TabBar() {
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const closeTab = useAppStore((s) => s.closeTab);
  const mainView = useAppStore((s) => s.mainView);
  const mainActive = activeTabId === MAIN_VIEW_ID || activeTabId === null;

  return (
    <div className="tab-bar">
      {/* primary surface — always present, not closable, title follows the tree */}
      <div
        className={`tab-item ${mainActive ? 'active' : ''}`}
        onClick={() => setActiveTab(MAIN_VIEW_ID)}
        title={mainView.title}
      >
        {kindIcon[mainView.kind] || null}
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {mainView.title}
        </span>
      </div>

      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`tab-item ${activeTabId === tab.id ? 'active' : ''}`}
          onClick={() => setActiveTab(tab.id)}
          onAuxClick={(e) => {
            // middle-click closes, like browser tabs
            if (e.button === 1 && tab.closable !== false) closeTab(tab.id);
          }}
          title={tab.title}
        >
          {kindIcon[tab.kind] || null}
          <span
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {tab.title}
          </span>
          {tab.closable !== false && (
            <span
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
            >
              <X size={12} />
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
