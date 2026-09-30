export type ConnectionKind = 'tcp' | 'unix' | 'ssh';

/** Sidebar folder that groups Docker connections. */
export interface ConnectionGroup {
  id: string;
  name: string;
}

export interface DockerConnectionConfig {
  id: string;
  name: string;
  kind: ConnectionKind;
  /** sidebar folder id; omitted = root */
  groupId?: string;
  host?: string;
  port?: number;
  tls?: boolean;
  caCertPath?: string;
  certPath?: string;
  keyPath?: string;
  ca?: string;
  cert?: string;
  key?: string;
  sshHost?: string;
  sshPort?: number;
  sshUser?: string;
  sshPassword?: string;
  sshPrivateKeyPath?: string;
  sshPassphrase?: string;
  dockerSocketPath?: string;
  socketPath?: string;
}

export interface DockerInfoLite {
  name?: string;
  serverVersion?: string;
  os?: string;
  arch?: string;
  nCPU?: number;
  memTotal?: number;
  containers?: number;
  containersRunning?: number;
  containersPaused?: number;
  containersStopped?: number;
  images?: number;
  driver?: string;
}

export interface ConnectionStatus {
  id: string;
  connected: boolean;
  error?: string;
  info?: DockerInfoLite;
}

export interface ContainerSummary {
  id: string;
  name: string;
  image: string;
  imageId: string;
  state: string;
  status: string;
  created: number;
  ports: { ip?: string; privatePort: number; publicPort?: number; type: string }[];
  labels: Record<string, string>;
  composeProject?: string;
  composeService?: string;
  networkMode?: string;
}

export interface ContainerDetail extends ContainerSummary {
  command?: string;
  env?: string[];
  mounts?: { type?: string; source?: string; destination?: string }[];
  networks?: string[];
  restartCount?: number;
  restartPolicy?: 'no' | 'always' | 'on-failure' | 'unless-stopped';
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number;
  oomKilled?: boolean;
  /** Healthcheck result, when the image defines one. */
  health?: {
    status?: string;
    failingStreak?: number;
    log?: { exitCode?: number; output?: string; start?: string; end?: string }[];
  };
  platform?: string;
  hostname?: string;
  workingDir?: string;
  cpuPercent?: number;
  memUsage?: number;
  memLimit?: number;
  netRx?: number;
  netTx?: number;
  blockRead?: number;
  blockWrite?: number;
}

export interface ImageSummary {
  id: string;
  repoTags: string[];
  repoDigests: string[];
  created: number;
  size: number;
  virtualSize?: number;
  labels: Record<string, string>;
}

export interface ImageHistoryEntry {
  created?: string;
  createdBy?: string;
  comment?: string;
  size?: number;
  emptyLayer?: boolean;
}

export interface ImageDetail {
  id: string;
  repoTags: string[];
  repoDigests: string[];
  created: string;
  size: number;
  virtualSize?: number;
  architecture?: string;
  os?: string;
  author?: string;
  configCmd?: string;
  configEntrypoint?: string[];
  env?: string[];
  labels: Record<string, string>;
  history: ImageHistoryEntry[];
}

export interface NetworkSummary {
  id: string;
  name: string;
  driver: string;
  scope: string;
  created: string;
  internal: boolean;
  attachable: boolean;
  ingress: boolean;
  containers: { name: string; ipv4?: string; ipv6?: string; mac?: string }[];
  labels: Record<string, string>;
  subnet?: string;
  gateway?: string;
}

export interface VolumeSummary {
  name: string;
  driver: string;
  mountpoint: string;
  created: string;
  labels: Record<string, string>;
  scope: string;
  status?: Record<string, unknown>;
}

export interface ComposeService {
  name: string;
  containerId?: string;
  containerName?: string;
  state?: string;
  status?: string;
  image?: string;
  replicas?: number;
}

export interface ComposeProject {
  name: string;
  services: ComposeService[];
  containers: ContainerSummary[];
  running: number;
  total: number;
}

export interface SystemStats {
  cpuPercent: number;
  memUsage: number;
  memLimit: number;
  memPercent: number;
  netRx: number;
  netTx: number;
  blockRead: number;
  blockWrite: number;
  containersRunning: number;
  containersTotal: number;
  images: number;
  volumes: number;
  networks: number;
}

export interface PortMapping {
  privatePort: number;
  publicPort?: number;
  type: string;
  hostIp?: string;
}

export interface VolumeMountSpec {
  source: string;
  destination: string;
  readOnly?: boolean;
  type?: 'bind' | 'volume';
}

export interface CreateContainerOptions {
  image: string;
  name?: string;
  cmd?: string[];
  env?: string[];
  entrypoint?: string[];
  workingDir?: string;
  user?: string;
  ports?: PortMapping[];
  volumes?: VolumeMountSpec[];
  network?: string;
  restartPolicy?: 'no' | 'always' | 'on-failure' | 'unless-stopped';
  labels?: Record<string, string>;
  autoRemove?: boolean;
  privileged?: boolean;
  tty?: boolean;
  stdinOpen?: boolean;
  hostname?: string;
}

export interface CreateNetworkOptions {
  name: string;
  driver?: string;
  internal?: boolean;
  attachable?: boolean;
  subnet?: string;
  gateway?: string;
  labels?: Record<string, string>;
}

export interface CreateVolumeOptions {
  name: string;
  driver?: string;
  labels?: Record<string, string>;
}

export interface ContainerStatsSample {
  cpuPercent: number;
  memUsage: number;
  memLimit: number;
  memPercent: number;
  netRx: number;
  netTx: number;
  blockRead: number;
  blockWrite: number;
  ts: number;
}

export interface DockerEvent {
  hostId: string;
  type: string;
  action: string;
  id?: string;
  name?: string;
  image?: string;
  attributes: Record<string, string>;
  time: number;
}

export type ViewKind =
  | 'dashboard'
  | 'containers'
  | 'images'
  | 'networks'
  | 'volumes'
  | 'compose'
  | 'composeProject'
  | 'containerDetail'
  | 'logs'
  | 'composeLogs'
  | 'terminal'
  | 'settings';

export interface OpenTab {
  id: string;
  title: string;
  kind: ViewKind;
  hostId?: string;
  containerId?: string;
  projectName?: string;
  closable?: boolean;
}

declare global {
  interface Window {
    dockerApi: {
      listConnections(): Promise<DockerConnectionConfig[]>;
      upsertConnection(cfg: DockerConnectionConfig): Promise<DockerConnectionConfig>;
      removeConnection(id: string): Promise<boolean>;
      listGroups(): Promise<ConnectionGroup[]>;
      upsertGroup(group: ConnectionGroup): Promise<ConnectionGroup>;
      removeGroup(id: string): Promise<boolean>;
      testConnection(cfg: DockerConnectionConfig): Promise<{ ok: boolean; info?: DockerInfoLite; error?: string }>;
      connect(id: string): Promise<ConnectionStatus>;
      disconnect(id: string): Promise<boolean>;
      listStatuses(): Promise<ConnectionStatus[]>;

      listContainers(hostId: string, all?: boolean): Promise<ContainerSummary[]>;
      inspectContainer(hostId: string, id: string): Promise<ContainerDetail>;
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

      openLogs(hostId: string, containerId: string, tail?: number): Promise<boolean>;
      closeLogs(hostId: string, containerId: string): Promise<boolean>;
      onLogData(cb: (p: { key: string; data: string }) => void): () => void;
      onLogError(cb: (p: { key: string; error: string }) => void): () => void;
      onLogEnd(cb: (p: { key: string }) => void): () => void;

      openExec(hostId: string, containerId: string, sessionId: string): Promise<boolean>;
      execInput(sessionId: string, data: string): Promise<boolean>;
      execResize(sessionId: string, h: number, w: number): Promise<boolean>;
      closeExec(sessionId: string): Promise<boolean>;
      onExecData(cb: (p: { sessionId: string; data: string }) => void): () => void;
      onExecError(cb: (p: { sessionId: string; error: string }) => void): () => void;
      onExecEnd(cb: (p: { sessionId: string }) => void): () => void;

      listImages(hostId: string): Promise<ImageSummary[]>;
      inspectImage(hostId: string, id: string): Promise<ImageDetail>;
      removeImage(hostId: string, id: string, force?: boolean): Promise<boolean>;
      tagImage(hostId: string, id: string, repo: string, tag?: string): Promise<boolean>;
      pullImage(hostId: string, name: string): Promise<boolean>;
      onPullProgress(cb: (p: { name: string; message: string }) => void): () => void;

      listNetworks(hostId: string): Promise<NetworkSummary[]>;
      removeNetwork(hostId: string, id: string): Promise<boolean>;
      listVolumes(hostId: string): Promise<VolumeSummary[]>;
      removeVolume(hostId: string, name: string, force?: boolean): Promise<boolean>;

      listComposeProjects(hostId: string): Promise<ComposeProject[]>;
      listUnclassified(hostId: string): Promise<ContainerSummary[]>;
      systemStats(hostId: string): Promise<SystemStats>;
      systemInfo(hostId: string): Promise<DockerInfoLite | undefined>;

      createContainer(hostId: string, opts: CreateContainerOptions, start?: boolean): Promise<string>;
      createNetwork(hostId: string, opts: CreateNetworkOptions): Promise<string>;
      createVolume(hostId: string, opts: CreateVolumeOptions): Promise<string>;
      composeUp(
        hostId: string,
        filePath: string
      ): Promise<{ ok: boolean; output: string; exitCode: number | null }>;
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
      onStatsData(
        cb: (p: { key: string; hostId: string; containerId: string; sample: ContainerStatsSample }) => void
      ): () => void;
      onStatsError(cb: (p: { key: string; error: string }) => void): () => void;

      openEvents(hostId: string): Promise<boolean>;
      closeEvents(hostId: string): Promise<boolean>;
      onDockerEvent(cb: (p: DockerEvent) => void): () => void;
      onEventError(cb: (p: { hostId: string; error: string }) => void): () => void;

      cleanupAll(): Promise<boolean>;
    };
  }
}
