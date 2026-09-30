import { create } from 'zustand';
import type {
  ConnectionStatus,
  ContainerSummary,
  DockerConnectionConfig,
  OpenTab,
} from '../types/docker';

interface Toast {
  id: string;
  message: string;
  type: 'info' | 'success' | 'error';
}

interface AppState {
  connections: DockerConnectionConfig[];
  statuses: Record<string, ConnectionStatus>;
  expandedHosts: Record<string, boolean>;
  expandedCompose: Record<string, boolean>;
  selectedTreeKey: string | null;
  selectedHostId: string | null;
  tabs: OpenTab[];
  activeTabId: string | null;
  toasts: Toast[];
  containersByHost: Record<string, ContainerSummary[]>;
  refreshing: boolean;

  setConnections: (list: DockerConnectionConfig[]) => void;
  upsertConnection: (cfg: DockerConnectionConfig) => void;
  removeConnectionLocal: (id: string) => void;
  setStatus: (status: ConnectionStatus) => void;
  setAllStatuses: (list: ConnectionStatus[]) => void;

  toggleHost: (id: string) => void;
  toggleCompose: (key: string) => void;
  selectTree: (key: string | null, hostId?: string | null) => void;

  openTab: (tab: OpenTab) => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;

  toast: (message: string, type?: Toast['type']) => void;
  dismissToast: (id: string) => void;

  setContainers: (hostId: string, list: ContainerSummary[]) => void;
  setRefreshing: (v: boolean) => void;

  /** bumped whenever a docker event suggests lists should re-fetch */
  containersVersion: number;
  bumpContainers: () => void;
  /** per-host last event action, useful for subtle live badges */
  lastEventByHost: Record<string, string>;
  noteEvent: (hostId: string, action: string) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  connections: [],
  statuses: {},
  expandedHosts: {},
  expandedCompose: {},
  selectedTreeKey: null,
  selectedHostId: null,
  tabs: [],
  activeTabId: null,
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
    set({
      connections: get().connections.filter((c) => c.id !== id),
      statuses,
    });
  },

  setStatus: (status) =>
    set({ statuses: { ...get().statuses, [status.id]: status } }),

  setAllStatuses: (list) => {
    const map: Record<string, ConnectionStatus> = {};
    for (const s of list) map[s.id] = s;
    set({ statuses: map });
  },

  toggleHost: (id) =>
    set({ expandedHosts: { ...get().expandedHosts, [id]: !get().expandedHosts[id] } }),

  toggleCompose: (key) =>
    set({ expandedCompose: { ...get().expandedCompose, [key]: !get().expandedCompose[key] } }),

  selectTree: (key, hostId) =>
    set({
      selectedTreeKey: key,
      selectedHostId: hostId === undefined ? get().selectedHostId : hostId,
    }),

  openTab: (tab) => {
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
      active = tabs.length ? tabs[tabs.length - 1].id : null;
    }
    set({ tabs, activeTabId: active });
  },

  setActiveTab: (id) => set({ activeTabId: id }),

  toast: (message, type = 'info') => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    set({ toasts: [...get().toasts, { id, message, type }] });
    setTimeout(() => {
      set({ toasts: get().toasts.filter((t) => t.id !== id) });
    }, 3500);
  },

  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),

  setContainers: (hostId, list) =>
    set({ containersByHost: { ...get().containersByHost, [hostId]: list } }),

  setRefreshing: (v) => set({ refreshing: v }),

  containersVersion: 0,
  bumpContainers: () => set({ containersVersion: get().containersVersion + 1 }),
  lastEventByHost: {},
  noteEvent: (hostId, action) =>
    set({ lastEventByHost: { ...get().lastEventByHost, [hostId]: action } }),
}));
