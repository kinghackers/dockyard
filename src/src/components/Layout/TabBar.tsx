import { useState } from 'react';
import { X, LayoutDashboard, Boxes, Image, Network, Database, Layers, FileText, Terminal as Term, Settings, LayoutGrid, Home } from 'lucide-react';
import { useAppStore, MAIN_VIEW_ID } from '../../stores/appStore';
import type { ViewKind } from '../../types/docker';
import { t, useT } from '../../i18n';

const kindIcon: Record<ViewKind, React.ReactNode> = {
  home: <Home size={13} />,
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
  aggregateContainers: <LayoutGrid size={13} />,
  settings: <Settings size={13} />,
};

export function TabBar() {
  const t = useT();
  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const closeTab = useAppStore((s) => s.closeTab);
  const moveTab = useAppStore((s) => s.moveTab);
  const mainView = useAppStore((s) => s.mainView);
  const mainActive = activeTabId === MAIN_VIEW_ID || activeTabId === null;
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  // Fixed UI labels (home / settings / aggregate) are re-derived from kind so
  // they track the active locale — tab titles are otherwise frozen at the
  // moment the tab was opened (the home view is created before locale resolves).
  const fixedKindTitle = (kind: ViewKind): string | null => {
    if (kind === 'home') return t('主页');
    if (kind === 'settings') return t('设置');
    if (kind === 'aggregateContainers') return t('所有容器');
    return null;
  };

  return (
    <div className="tab-bar">
      {/* primary surface — always present, not closable, title follows the tree */}
      <div
        className={`tab-item ${mainActive ? 'active' : ''}`}
        onClick={() => setActiveTab(MAIN_VIEW_ID)}
        title={fixedKindTitle(mainView.kind) ?? mainView.title}
      >
        {kindIcon[mainView.kind] || null}
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {fixedKindTitle(mainView.kind) ?? mainView.title}
        </span>
      </div>

      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`tab-item ${activeTabId === tab.id ? 'active' : ''} ${dragId === tab.id ? 'dragging' : ''} ${overId === tab.id && dragId !== tab.id ? 'drop-target' : ''}`}
          draggable
          onDragStart={(e) => {
            setDragId(tab.id);
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', tab.id);
          }}
          onDragEnd={() => {
            setDragId(null);
            setOverId(null);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (dragId && dragId !== tab.id) setOverId(tab.id);
          }}
          onDragLeave={() => setOverId((v) => (v === tab.id ? null : v))}
          onDrop={(e) => {
            e.preventDefault();
            const from = dragId || e.dataTransfer.getData('text/plain');
            if (from) moveTab(from, tab.id);
            setDragId(null);
            setOverId(null);
          }}
          onClick={() => setActiveTab(tab.id)}
          onAuxClick={(e) => {
            // middle-click closes, like browser tabs
            if (e.button === 1 && tab.closable !== false) closeTab(tab.id);
          }}
          title={fixedKindTitle(tab.kind) ?? tab.title}
        >
          {kindIcon[tab.kind] || null}
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {fixedKindTitle(tab.kind) ?? tab.title}
            </span>
            {tab.closable !== false && (
              <span
                className="tab-close"
                role="button"
                aria-label={t("关闭 {p0}", { p0: fixedKindTitle(tab.kind) ?? tab.title })}
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
