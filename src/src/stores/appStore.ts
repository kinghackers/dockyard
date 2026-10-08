import { create } from 'zustand';
import type {
  ConnectionGroup,
  ConnectionStatus,
  ContainerSummary,
  DockerConnectionConfig,
  OpenTab,
} from '../types/docker';
import { loadUiPref, saveUiPref } from '../utils/uiPrefs';

/** Stable id for the single primary content surface driven by the tree. */
export const MAIN_VIEW_ID = '__main_view__';

const EVENTS_PREF = 'events.recent';
const MAX_RECENT_EVENTS = 40;

interface Toast {
  id: string;
  message: string;
  type: 'info' | 'success' | 'error';
}

/** Kinds that render as closable session tabs instead of the main surface.
 *  Per-host dashboards join them via the hostId check in openTab. */
const SESSION_TAB_KINDS: ReadonlySet<OpenTab['kind']> = new Set([
  'logs',
  'terminal',
  'composeLogs',
  'aggregateContainers',
  'settings',
]);

/** Host-scoped page kinds: they switch inside the host's own tab
 *  (driven by hostViews) instead of spawning separate tabs. */
const HOST_PAGE_KINDS: ReadonlySet<OpenTab['kind']> = new Set([
  'dashboard',
  'containers',
  'images',
  'networks',
  'volumes',
  'compose',
  'composeProject',
  'containerDetail',
]);

const defaultMainView: OpenTab = {
  id: MAIN_VIEW_ID,
  title: '主页',
  kind: 'home',
  closable: false,
};

interface AppState {
  connections: DockerConnectionConfig[];
  groups: ConnectionGroup[];
  statuses: Record<string, ConnectionStatus>;
  expandedHosts: Record<string, boolean>;
  expandedGroups: Record<string, boolean>;
  expandedCompose: Record<string, boolean>;
  /** collapsible "容器" folder per host (loose containers live inside) */
  expandedContainers: Record<string, boolean>;
  selectedTreeKey: string | null;
  selectedHostId: string | null;
  /** Single content surface shown in the main area (driven by tree selection). */
  mainView: OpenTab;
  /** Session tabs only: logs / terminal. */
  tabs: OpenTab[];
  activeTabId: string | null;
  toasts: Toast[];
  containersByHost: Record<string, ContainerSummary[]>;
  refreshing: boolean;

  setConnections: (list: DockerConnectionConfig[]) => void;
  upsertConnection: (cfg: DockerConnectionConfig) => void;
  removeConnectionLocal: (id: string) => void;
  setGroups: (list: ConnectionGroup[]) => void;
  upsertGroupLocal: (group: ConnectionGroup) => void;
  removeGroupLocal: (id: string) => void;
  setStatus: (status: ConnectionStatus) => void;
  setAllStatuses: (list: ConnectionStatus[]) => void;

  toggleHost: (id: string) => void;
  toggleGroup: (id: string) => void;
  toggleCompose: (key: string) => void;
  toggleContainers: (key: string) => void;
  selectTree: (key: string | null, hostId?: string | null) => void;

  /** Switch the primary content surface (tree navigation). Does not create tabs. */
  setMainView: (view: Omit<OpenTab, 'id' | 'closable'>) => void;
  /** Current in-tab view per host tab — pages switch inside the host's tab. */
  hostViews: Record<string, OpenTab>;
  /** Open (or focus) a host's tab and switch the page shown inside it. */
  openHostView: (hostId: string, view: Omit<OpenTab, 'id' | 'closable'>) => void;
  /** Open a session tab (logs / terminal / aggregate / settings). */
  openTab: (tab: OpenTab) => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;

  toast: (message: string, type?: Toast['type'], durationMs?: number) => void;
  dismissToast: (id: string) => void;

  setContainers: (hostId: string, list: ContainerSummary[]) => void;
  setRefreshing: (v: boolean) => void;

  /** bumped (debounced) whenever docker events suggest lists should re-fetch */
  containersVersion: number;
  bumpContainers: () => void;
  /** rolling event feed for the dashboard */
  recentEvents: { id: string; hostId: string; type: string; action: string; name?: string; time: number }[];
  pushEvent: (e: {
    hostId: string;
    type: string;
    action: string;
    name?: string;
    time: number;
  }) => void;
}

// Docker events arrive in bursts (a compose up fires dozens within a second);
// one version bump per burst is enough and avoids N× full refetch storms.
let bumpDebounce: ReturnType<typeof setTimeout> | null = null;

export const useAppStore = create<AppState>((set, get) => ({
  connections: [],
  groups: [],
  statuses: {},
  expandedHosts: loadUiPref('sidebar.expandedHosts', {}),
  expandedGroups: loadUiPref('sidebar.expandedGroups', {}),
  expandedCompose: loadUiPref('sidebar.expandedCompose', {}),
  expandedContainers: loadUiPref('sidebar.expandedContainers', {}),
  selectedTreeKey: null,
  selectedHostId: null,
  mainView: defaultMainView,
  tabs: [],
  activeTabId: MAIN_VIEW_ID,
  toasts: [],
  containersByHost: {},
  refreshing: false,

  setConnections: (list) => set({ connections: list }),

  upsertConnection: (cfg) => {
    const list = get().connections.filter((c) => c.id !== cfg.id);
    set({ connections: [...list, cfg] });
  },

  removeConnectionLocal: (id) => {
    const statuses = { ...get().statuses };
    delete statuses[id];
    // drop session tabs (dashboard / logs / terminal) scoped to the removed host
    const tabs = get().tabs.filter((t) => t.hostId !== id);
    let activeTabId = get().activeTabId;
    if (activeTabId && tabs.every((t) => t.id !== activeTabId)) {
      activeTabId = tabs.length ? tabs[tabs.length - 1].id : MAIN_VIEW_ID;
    }
    const hostViews = { ...get().hostViews };
    delete hostViews[id];
    set({
      connections: get().connections.filter((c) => c.id !== id),
      statuses,
      tabs,
      activeTabId,
      hostViews,
    });
  },

  setGroups: (list) => set({ groups: list }),

  upsertGroupLocal: (group) => {
    const list = get().groups.filter((g) => g.id !== group.id);
    set({ groups: [...list, group] });
  },

  removeGroupLocal: (id) => {
    set({
      groups: get().groups.filter((g) => g.id !== id),
      // connections fall back to root
      connections: get().connections.map((c) =>
        c.groupId === id ? { ...c, groupId: undefined } : c
      ),
    });
  },

  setStatus: (status) =>
    set({ statuses: { ...get().statuses, [status.id]: status } }),

  setAllStatuses: (list) => {
    const map: Record<string, ConnectionStatus> = {};
    for (const s of list) map[s.id] = s;
    set({ statuses: map });
  },

  toggleHost: (id) => {
    const expandedHosts = { ...get().expandedHosts, [id]: !get().expandedHosts[id] };
    saveUiPref('sidebar.expandedHosts', expandedHosts);
    set({ expandedHosts });
  },

  toggleGroup: (id) => {
    const expandedGroups = { ...get().expandedGroups, [id]: !get().expandedGroups[id] };
    saveUiPref('sidebar.expandedGroups', expandedGroups);
    set({ expandedGroups });
  },

  toggleCompose: (key) => {
    const expandedCompose = { ...get().expandedCompose, [key]: !get().expandedCompose[key] };
    saveUiPref('sidebar.expandedCompose', expandedCompose);
    set({ expandedCompose });
  },

  toggleContainers: (key) => {
    const expandedContainers = {
      ...get().expandedContainers,
      [key]: !get().expandedContainers[key],
    };
    saveUiPref('sidebar.expandedContainers', expandedContainers);
    set({ expandedContainers });
  },

  selectTree: (key, hostId) =>
    set({
      selectedTreeKey: key,
      selectedHostId: hostId === undefined ? get().selectedHostId : hostId,
    }),

  setMainView: (view) => {
    set({
      mainView: {
        ...view,
        id: MAIN_VIEW_ID,
        closable: false,
      },
      // tree navigation always returns to the primary surface
      activeTabId: MAIN_VIEW_ID,
    });
  },

  hostViews: {},

  openHostView: (hostId, view) => {
    const tabId = `dashboard:${hostId}`;
    set({
      hostViews: { ...get().hostViews, [hostId]: { ...view, id: tabId, closable: false } },
    });
    const tabs = get().tabs;
    if (tabs.some((t) => t.id === tabId)) {
      set({ activeTabId: tabId });
      return;
    }
    const conn = get().connections.find((c) => c.id === hostId);
    set({
      tabs: [
        ...tabs,
        { id: tabId, title: conn?.name || hostId, kind: 'dashboard', hostId, closable: true },
      ],
      activeTabId: tabId,
    });
  },

  openTab: (tab) => {
    // host-scoped pages (dashboard / lists / details) switch inside the
    // host's own tab — one tab per Docker connection
    if (tab.hostId && HOST_PAGE_KINDS.has(tab.kind)) {
      get().openHostView(tab.hostId, tab);
      return;
    }
    // remaining session tabs (logs / terminal / aggregate / settings)
    if (!SESSION_TAB_KINDS.has(tab.kind)) {
      get().setMainView(tab);
      return;
    }
    const tabs = get().tabs;
    const existing = tabs.find((t) => t.id === tab.id);
    if (existing) {
      set({ activeTabId: tab.id });
      return;
    }
    set({
      tabs: [...tabs, { closable: true, ...tab }],
      activeTabId: tab.id,
    });
  },

  closeTab: (id) => {
    const tabs = get().tabs.filter((t) => t.id !== id);
    let active = get().activeTabId;
    if (active === id) {
      active = tabs.length ? tabs[tabs.length - 1].id : MAIN_VIEW_ID;
    }
    set({ tabs, activeTabId: active });
  },

  setActiveTab: (id) => set({ activeTabId: id }),

  toast: (message, type = 'info', durationMs = 3500) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    set({ toasts: [...get().toasts, { id, message, type }] });
    setTimeout(() => {
      set({ toasts: get().toasts.filter((t) => t.id !== id) });
    }, durationMs);
  },

  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),

  setContainers: (hostId, list) =>
    set({ containersByHost: { ...get().containersByHost, [hostId]: list } }),

  setRefreshing: (v) => set({ refreshing: v }),

  containersVersion: 0,
  bumpContainers: () => {
    if (bumpDebounce) clearTimeout(bumpDebounce);
    bumpDebounce = setTimeout(() => {
      bumpDebounce = null;
      set({ containersVersion: get().containersVersion + 1 });
    }, 300);
  },
  recentEvents: loadUiPref<AppState['recentEvents']>(EVENTS_PREF, []).slice(0, MAX_RECENT_EVENTS),
  pushEvent: (e) => {
    const item = {
      id: `${e.time}-${Math.random().toString(36).slice(2, 7)}`,
      hostId: e.hostId,
      type: e.type,
      action: e.action,
      name: e.name,
      time: e.time,
    };
    const next = [item, ...get().recentEvents];
    const capped = next.length > MAX_RECENT_EVENTS ? next.slice(0, MAX_RECENT_EVENTS) : next;
    set({ recentEvents: capped });
    saveUiPref(EVENTS_PREF, capped);
  },
}));
