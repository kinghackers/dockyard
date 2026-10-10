import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore, MAIN_VIEW_ID } from '../stores/appStore';
import type { OpenTab } from '../types/docker';

const hostDash = (hostId: string): OpenTab => ({
  id: `dashboard:${hostId}`,
  title: hostId,
  kind: 'dashboard',
  hostId,
});

describe('appStore tab routing', () => {
  beforeEach(() => {
    useAppStore.setState({
      tabs: [],
      activeTabId: MAIN_VIEW_ID,
      hostViews: {},
      mainView: { id: MAIN_VIEW_ID, title: '主页', kind: 'home', closable: false },
    });
  });

  it('per-host dashboard opens one closable tab per connection', () => {
    const s = useAppStore.getState();
    s.openTab(hostDash('a'));
    s.openTab(hostDash('b'));

    const { tabs, activeTabId } = useAppStore.getState();
    expect(tabs.map((t) => t.id)).toEqual(['dashboard:a', 'dashboard:b']);
    expect(activeTabId).toBe('dashboard:b');
    expect(tabs.every((t) => t.closable !== false)).toBe(true);
  });

  it('re-clicking a host focuses its existing tab instead of duplicating', () => {
    const s = useAppStore.getState();
    s.openTab(hostDash('a'));
    s.openTab(hostDash('b'));
    s.openTab(hostDash('a'));

    const { tabs, activeTabId } = useAppStore.getState();
    expect(tabs.map((t) => t.id)).toEqual(['dashboard:a', 'dashboard:b']);
    expect(activeTabId).toBe('dashboard:a');
  });

  it('per-host list views switch inside the host tab, not on the main surface', () => {
    const s = useAppStore.getState();
    s.openTab(hostDash('a'));
    s.openTab({ id: 'containers:a', title: '容器列表', kind: 'containers', hostId: 'a' });
    s.openTab({ id: 'images:a', title: '镜像列表', kind: 'images', hostId: 'a' });

    const { tabs, hostViews, mainView } = useAppStore.getState();
    // still just the one host tab
    expect(tabs.map((t) => t.id)).toEqual(['dashboard:a']);
    expect(hostViews['a']?.kind).toBe('images');
    expect(mainView.kind).toBe('home');
  });

  it('container detail navigates back into the host tab as well', () => {
    const s = useAppStore.getState();
    s.openTab({
      id: 'containerDetail:a:c1',
      title: '容器: c1',
      kind: 'containerDetail',
      hostId: 'a',
      containerId: 'c1',
    });

    const { tabs, hostViews } = useAppStore.getState();
    expect(tabs.map((t) => t.id)).toEqual(['dashboard:a']);
    expect(hostViews['a']?.kind).toBe('containerDetail');
    expect(hostViews['a']?.containerId).toBe('c1');
  });

  it('default main surface is the home, not a shared dashboard', () => {
    useAppStore.setState(useAppStore.getInitialState());
    const { mainView } = useAppStore.getState();
    expect(mainView.kind).toBe('home');
    expect(mainView.closable).toBe(false);
  });

  it('host-less overview dashboard routes to the main surface, not a tab', () => {
    const s = useAppStore.getState();
    s.openTab({ id: 'dashboard:overview', title: '仪表板', kind: 'dashboard' });

    const { tabs, mainView } = useAppStore.getState();
    expect(tabs).toHaveLength(0);
    expect(mainView.kind).toBe('dashboard');
    expect(mainView.id).toBe(MAIN_VIEW_ID);
    expect(mainView.closable).toBe(false);
  });

  it('aggregate containers and settings open as closable tabs, not the main surface', () => {
    const s = useAppStore.getState();
    s.openTab({ id: 'aggregateContainers', title: '所有容器', kind: 'aggregateContainers' });
    s.openTab({ id: 'settings', title: '设置', kind: 'settings' });

    const { tabs, mainView } = useAppStore.getState();
    expect(tabs.map((t) => t.id)).toEqual(['aggregateContainers', 'settings']);
    expect(tabs.every((t) => t.closable !== false)).toBe(true);
    expect(mainView.kind).toBe('home');
  });

  it('closing the active host tab falls back to another tab or home', () => {
    const s = useAppStore.getState();
    s.openTab(hostDash('a'));
    s.openTab(hostDash('b'));
    s.closeTab('dashboard:b');

    const { tabs, activeTabId } = useAppStore.getState();
    expect(tabs.map((t) => t.id)).toEqual(['dashboard:a']);
    expect(activeTabId).toBe('dashboard:a');
  });

  it('removing a connection drops its tab and host view state', () => {
    const s = useAppStore.getState();
    s.openTab(hostDash('a'));
    s.openTab(hostDash('b'));
    useAppStore.setState({ connections: [{ id: 'a', name: 'a', kind: 'unix' }] });

    useAppStore.getState().removeConnectionLocal('a');
    const { tabs, activeTabId, hostViews } = useAppStore.getState();
    expect(tabs.map((t) => t.id)).toEqual(['dashboard:b']);
    expect(activeTabId).toBe('dashboard:b');
    expect(hostViews['a']).toBeUndefined();
  });
});
