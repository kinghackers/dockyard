import { X, LayoutDashboard, Boxes, Image, Network, Database, Layers, FileText, Terminal as Term } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
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
  terminal: <Term size={13} />,
  settings: <FileText size={13} />,
};

export function TabBar() {
  const { tabs, activeTabId, setActiveTab, closeTab } = useAppStore();

  if (tabs.length === 0) return <div className="tab-bar" />;

  return (
    <div className="tab-bar">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`tab-item ${activeTabId === tab.id ? 'active' : ''}`}
          onClick={() => setActiveTab(tab.id)}
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
