import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

export interface DockerApi {
  listConnections(): Promise<unknown[]>;
  configHealth(): Promise<{ loadError: string | null; encryptionAvailable: boolean }>;
  upsertConnection(cfg: unknown): Promise<unknown>;
  removeConnection(id: string): Promise<boolean>;
  listGroups(): Promise<unknown[]>;
  upsertGroup(group: unknown): Promise<unknown>;
  removeGroup(id: string): Promise<boolean>;
  testConnection(cfg: unknown): Promise<unknown>;
  connect(id: string): Promise<unknown>;
  disconnect(id: string): Promise<boolean>;
  listStatuses(): Promise<unknown[]>;

  listContainers(hostId: string, all?: boolean, enrichPorts?: boolean): Promise<unknown[]>;
  inspectContainer(hostId: string, id: string): Promise<unknown>;
  startContainer(hostId: string, id: string): Promise<boolean>;
  stopContainer(hostId: string, id: string): Promise<boolean>;
  restartContainer(hostId: string, id: string): Promise<boolean>;
  killContainer(hostId: string, id: string): Promise<boolean>;
  updateRestartPolicy(
    hostId: string,
    id: string,
    policy: 'no' | 'always' | 'on-failure' | 'unless-stopped',
    maximumRetryCount?: number
  ): Promise<boolean>;
  stopRestartLoop(hostId: string, id: string): Promise<'stopped' | 'killed' | 'already-stopped'>;
  removeContainer(hostId: string, id: string, force?: boolean): Promise<boolean>;
  pauseContainer(hostId: string, id: string): Promise<boolean>;
  unpauseContainer(hostId: string, id: string): Promise<boolean>;
  renameContainer(hostId: string, id: string, name: string): Promise<boolean>;
  updateContainerResources(
    hostId: string,
    id: string,
    opts: { memoryMB?: number; cpuCores?: number }
  ): Promise<boolean>;
  commitContainer(
    hostId: string,
    id: string,
    opts: { repo: string; tag?: string; comment?: string }
  ): Promise<string>;

  openLogs(hostId: string, containerId: string, tail?: number): Promise<boolean>;
  closeLogs(hostId: string, containerId: string): Promise<boolean>;
  onLogData(cb: (payload: { key: string; data: string }) => void): () => void;
  onLogError(cb: (payload: { key: string; error: string }) => void): () => void;
  onLogEnd(cb: (payload: { key: string }) => void): () => void;

  openExec(hostId: string, containerId: string, sessionId: string): Promise<boolean>;
  execInput(sessionId: string, data: string): Promise<boolean>;
  execResize(sessionId: string, h: number, w: number): Promise<boolean>;
  closeExec(sessionId: string): Promise<boolean>;
  onExecData(cb: (payload: { sessionId: string; data: string }) => void): () => void;
  onExecError(cb: (payload: { sessionId: string; error: string }) => void): () => void;
  onExecEnd(cb: (payload: { sessionId: string }) => void): () => void;

  listImages(hostId: string): Promise<unknown[]>;
  inspectImage(hostId: string, id: string): Promise<unknown>;
  removeImage(hostId: string, id: string, force?: boolean): Promise<boolean>;
  tagImage(hostId: string, id: string, repo: string, tag?: string): Promise<boolean>;
  pullImage(hostId: string, name: string): Promise<boolean>;
  onPullProgress(cb: (payload: { name: string; message: string }) => void): () => void;
  pushImage(hostId: string, name: string): Promise<boolean>;
  onPushProgress(cb: (payload: { name: string; message: string }) => void): () => void;
  saveImage(
    hostId: string,
    name: string
  ): Promise<{ ok: boolean; canceled?: boolean; path?: string; bytes?: number; error?: string }>;
  loadImage(hostId: string): Promise<{ ok: boolean; canceled?: boolean; path?: string; output?: string; error?: string }>;

  listNetworks(hostId: string): Promise<unknown[]>;
  removeNetwork(hostId: string, id: string): Promise<boolean>;
  listVolumes(hostId: string): Promise<unknown[]>;
  removeVolume(hostId: string, name: string, force?: boolean): Promise<boolean>;

  listComposeProjects(hostId: string): Promise<unknown[]>;
  listUnclassified(hostId: string): Promise<unknown[]>;
  systemDf(hostId: string): Promise<{
    images: number;
    danglingImages: number;
    danglingImageBytes: number;
    containers: number;
    stoppedContainers: number;
    stoppedContainerBytes: number;
    volumes: number;
    unusedVolumes: number;
    unusedVolumeBytes: number;
    reclaimableBytes: number;
  }>;
  pruneSystem(
    hostId: string,
    opts: {
      danglingImages?: boolean;
      stoppedContainers?: boolean;
      unusedNetworks?: boolean;
      unusedVolumes?: boolean;
    }
  ): Promise<{
    imagesDeleted: number;
    containersDeleted: number;
    networksDeleted: number;
    volumesDeleted: number;
  }>;
  systemStats(hostId: string): Promise<unknown>;
  systemInfo(hostId: string): Promise<unknown>;

  createContainer(hostId: string, opts: unknown, start?: boolean): Promise<string>;
  createNetwork(hostId: string, opts: unknown): Promise<string>;
  createVolume(hostId: string, opts: unknown): Promise<string>;
  composeUp(hostId: string, filePath: string): Promise<{ ok: boolean; output: string; exitCode: number | null }>;
  composeFileDown(
    hostId: string,
    filePath: string,
    volumes?: boolean
  ): Promise<{ ok: boolean; output: string; exitCode: number | null }>;
  composeProjectDown(
    hostId: string,
    projectName: string,
    volumes?: boolean
  ): Promise<{ ok: boolean; output: string; exitCode: number | null }>;
  composeProjectPull(
    hostId: string,
    projectName: string
  ): Promise<{ ok: boolean; output: string; exitCode: number | null }>;
  selectFile(filters?: { name: string; extensions: string[] }[]): Promise<string | null>;
  readTextFile(filePath: string): Promise<string>;

  openStats(hostId: string, containerId: string): Promise<boolean>;
  closeStats(hostId: string, containerId: string): Promise<boolean>;
  onStatsData(cb: (p: { key: string; hostId: string; containerId: string; sample: unknown }) => void): () => void;
  onStatsError(cb: (p: { key: string; error: string }) => void): () => void;

  openEvents(hostId: string): Promise<boolean>;
  closeEvents(hostId: string): Promise<boolean>;
  onDockerEvent(cb: (p: unknown) => void): () => void;
  onEventError(cb: (p: { hostId: string; error: string }) => void): () => void;

  cleanupAll(): Promise<boolean>;
  notify(title: string, body: string): void;
}

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: DockerApi = {
  listConnections: () => ipcRenderer.invoke('docker:listConnections'),
  configHealth: () => ipcRenderer.invoke('docker:configHealth'),
  upsertConnection: (cfg) => ipcRenderer.invoke('docker:upsertConnection', cfg),
  removeConnection: (id) => ipcRenderer.invoke('docker:removeConnection', id),
  listGroups: () => ipcRenderer.invoke('docker:listGroups'),
  upsertGroup: (group) => ipcRenderer.invoke('docker:upsertGroup', group),
  removeGroup: (id) => ipcRenderer.invoke('docker:removeGroup', id),
  testConnection: (cfg) => ipcRenderer.invoke('docker:testConnection', cfg),
  connect: (id) => ipcRenderer.invoke('docker:connect', id),
  disconnect: (id) => ipcRenderer.invoke('docker:disconnect', id),
  listStatuses: () => ipcRenderer.invoke('docker:listStatuses'),

  listContainers: (hostId, all, enrichPorts) =>
    ipcRenderer.invoke('docker:listContainers', hostId, all, enrichPorts),
  inspectContainer: (hostId, id) => ipcRenderer.invoke('docker:inspectContainer', hostId, id),
  startContainer: (hostId, id) => ipcRenderer.invoke('docker:startContainer', hostId, id),
  stopContainer: (hostId, id) => ipcRenderer.invoke('docker:stopContainer', hostId, id),
  restartContainer: (hostId, id) => ipcRenderer.invoke('docker:restartContainer', hostId, id),
  killContainer: (hostId, id) => ipcRenderer.invoke('docker:killContainer', hostId, id),
  updateRestartPolicy: (hostId, id, policy, maximumRetryCount) =>
    ipcRenderer.invoke('docker:updateRestartPolicy', hostId, id, policy, maximumRetryCount),
  stopRestartLoop: (hostId, id) => ipcRenderer.invoke('docker:stopRestartLoop', hostId, id),
  removeContainer: (hostId, id, force) => ipcRenderer.invoke('docker:removeContainer', hostId, id, force),
  pauseContainer: (hostId, id) => ipcRenderer.invoke('docker:pauseContainer', hostId, id),
  unpauseContainer: (hostId, id) => ipcRenderer.invoke('docker:unpauseContainer', hostId, id),
  renameContainer: (hostId, id, name) => ipcRenderer.invoke('docker:renameContainer', hostId, id, name),
  updateContainerResources: (hostId, id, opts) =>
    ipcRenderer.invoke('docker:updateContainerResources', hostId, id, opts),
  commitContainer: (hostId, id, opts) => ipcRenderer.invoke('docker:commitContainer', hostId, id, opts),

  openLogs: (hostId, containerId, tail) => ipcRenderer.invoke('docker:openLogs', hostId, containerId, tail),
  closeLogs: (hostId, containerId) => ipcRenderer.invoke('docker:closeLogs', hostId, containerId),
  onLogData: (cb) => subscribe('docker:logData', cb),
  onLogError: (cb) => subscribe('docker:logError', cb),
  onLogEnd: (cb) => subscribe('docker:logEnd', cb),

  openExec: (hostId, containerId, sessionId) => ipcRenderer.invoke('docker:openExec', hostId, containerId, sessionId),
  execInput: (sessionId, data) => ipcRenderer.invoke('docker:execInput', sessionId, data),
  execResize: (sessionId, h, w) => ipcRenderer.invoke('docker:execResize', sessionId, h, w),
  closeExec: (sessionId) => ipcRenderer.invoke('docker:closeExec', sessionId),
  onExecData: (cb) => subscribe('docker:execData', cb),
  onExecError: (cb) => subscribe('docker:execError', cb),
  onExecEnd: (cb) => subscribe('docker:execEnd', cb),

  listImages: (hostId) => ipcRenderer.invoke('docker:listImages', hostId),
  inspectImage: (hostId, id) => ipcRenderer.invoke('docker:inspectImage', hostId, id),
  removeImage: (hostId, id, force) => ipcRenderer.invoke('docker:removeImage', hostId, id, force),
  tagImage: (hostId, id, repo, tag) => ipcRenderer.invoke('docker:tagImage', hostId, id, repo, tag),
  pullImage: (hostId, name) => ipcRenderer.invoke('docker:pullImage', hostId, name),
  onPullProgress: (cb) => subscribe('docker:pullProgress', cb),
  pushImage: (hostId, name) => ipcRenderer.invoke('docker:pushImage', hostId, name),
  onPushProgress: (cb) => subscribe('docker:pushProgress', cb),
  saveImage: (hostId, name) => ipcRenderer.invoke('docker:saveImage', hostId, name),
  loadImage: (hostId) => ipcRenderer.invoke('docker:loadImage', hostId),

  listNetworks: (hostId) => ipcRenderer.invoke('docker:listNetworks', hostId),
  removeNetwork: (hostId, id) => ipcRenderer.invoke('docker:removeNetwork', hostId, id),
  listVolumes: (hostId) => ipcRenderer.invoke('docker:listVolumes', hostId),
  removeVolume: (hostId, name, force) => ipcRenderer.invoke('docker:removeVolume', hostId, name, force),

  listComposeProjects: (hostId) => ipcRenderer.invoke('docker:listComposeProjects', hostId),
  listUnclassified: (hostId) => ipcRenderer.invoke('docker:listUnclassified', hostId),
  systemDf: (hostId) => ipcRenderer.invoke('docker:systemDf', hostId),
  pruneSystem: (hostId, opts) => ipcRenderer.invoke('docker:pruneSystem', hostId, opts),
  systemStats: (hostId) => ipcRenderer.invoke('docker:systemStats', hostId),
  systemInfo: (hostId) => ipcRenderer.invoke('docker:systemInfo', hostId),

  createContainer: (hostId, opts, start) => ipcRenderer.invoke('docker:createContainer', hostId, opts, start),
  createNetwork: (hostId, opts) => ipcRenderer.invoke('docker:createNetwork', hostId, opts),
  createVolume: (hostId, opts) => ipcRenderer.invoke('docker:createVolume', hostId, opts),
  composeUp: (hostId, filePath) => ipcRenderer.invoke('docker:composeUp', hostId, filePath),
  composeFileDown: (hostId, filePath, volumes) =>
    ipcRenderer.invoke('docker:composeFileDown', hostId, filePath, volumes),
  composeProjectDown: (hostId, projectName, volumes) =>
    ipcRenderer.invoke('docker:composeProjectDown', hostId, projectName, volumes),
  composeProjectPull: (hostId, projectName) =>
    ipcRenderer.invoke('docker:composeProjectPull', hostId, projectName),
  selectFile: (filters) => ipcRenderer.invoke('docker:selectFile', filters),
  readTextFile: (filePath) => ipcRenderer.invoke('docker:readTextFile', filePath),

  openStats: (hostId, containerId) => ipcRenderer.invoke('docker:openStats', hostId, containerId),
  closeStats: (hostId, containerId) => ipcRenderer.invoke('docker:closeStats', hostId, containerId),
  onStatsData: (cb) => subscribe('docker:statsData', cb),
  onStatsError: (cb) => subscribe('docker:statsError', cb),

  openEvents: (hostId) => ipcRenderer.invoke('docker:openEvents', hostId),
  closeEvents: (hostId) => ipcRenderer.invoke('docker:closeEvents', hostId),
  onDockerEvent: (cb) => subscribe('docker:event', cb),
  onEventError: (cb) => subscribe('docker:eventError', cb),

  cleanupAll: () => ipcRenderer.invoke('docker:cleanupAll'),
  notify: (title, body) => ipcRenderer.send('ui:notify', { title, body }),
};

contextBridge.exposeInMainWorld('dockerApi', api);
