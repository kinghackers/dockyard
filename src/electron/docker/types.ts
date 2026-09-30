export type ConnectionKind = 'tcp' | 'unix' | 'ssh';

export interface DockerConnectionConfig {
  id: string;
  name: string;
  kind: ConnectionKind;
  /** tcp */
  host?: string;
  port?: number;
  /** tcp + tls */
  tls?: boolean;
  caCertPath?: string;
  certPath?: string;
  keyPath?: string;
  /** inline cert content (preferred when provided) */
  ca?: string;
  cert?: string;
  key?: string;
  /** ssh */
  sshHost?: string;
  sshPort?: number;
  sshUser?: string;
  sshPassword?: string;
  sshPrivateKeyPath?: string;
  sshPassphrase?: string;
  /** docker socket over ssh, default /var/run/docker.sock */
  dockerSocketPath?: string;
  /** unix */
  socketPath?: string;
}

export interface ConnectionStatus {
  id: string;
  connected: boolean;
  error?: string;
  info?: DockerInfoLite;
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
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number;
  oomKilled?: boolean;
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
  containers?: number;
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
  /** container port, e.g. 80 */
  privatePort: number;
  /** host port; empty = ephemeral */
  publicPort?: number;
  /** tcp | udp | sctp */
  type: string;
  /** host bind IP, default 0.0.0.0 */
  hostIp?: string;
}

export interface VolumeMountSpec {
  /** host path or volume name */
  source: string;
  /** container path */
  destination: string;
  readOnly?: boolean;
  /** bind | volume — inferred if omitted */
  type?: 'bind' | 'volume';
}

export interface CreateContainerOptions {
  image: string;
  name?: string;
  /** command args; empty = image default */
  cmd?: string[];
  /** KEY=value */
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
  /** unix ms */
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
