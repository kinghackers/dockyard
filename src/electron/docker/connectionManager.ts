import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import Docker = require('dockerode');
import {
  ComposeProject,
  ComposeService,
  ConnectionGroup,
  ConnectionStatus,
  ContainerDetail,
  ContainerStatsSample,
  ContainerSummary,
  CreateContainerOptions,
  CreateNetworkOptions,
  CreateVolumeOptions,
  DockerConnectionConfig,
  DockerEvent,
  DockerInfoLite,
  ImageSummary,
  NetworkSummary,
  SystemStats,
  VolumeSummary,
} from './types';
import { createSshDockerTunnel, SshTunnel } from './sshTunnel';

interface ManagedConnection {
  config: DockerConnectionConfig;
  docker: Docker;
  tunnel?: SshTunnel;
  status: ConnectionStatus;
}

function readCert(value: string | undefined, filePath: string | undefined): Buffer | undefined {
  if (value && value.trim().length > 0) return Buffer.from(value, 'utf8');
  if (filePath && fs.existsSync(filePath)) return fs.readFileSync(filePath);
  return undefined;
}

function toSummary(c: Docker.ContainerInfo): ContainerSummary {
  const name = (c.Names && c.Names[0] ? c.Names[0] : '').replace(/^\//, '');
  const labels = c.Labels || {};
  return {
    id: c.Id,
    name,
    image: c.Image,
    imageId: c.ImageID,
    state: c.State,
    status: c.Status,
    created: c.Created,
    ports: (c.Ports || []).map((p) => ({
      ip: p.IP,
      privatePort: p.PrivatePort,
      publicPort: p.PublicPort,
      type: p.Type,
    })),
    labels,
    composeProject: labels['com.docker.compose.project'],
    composeService: labels['com.docker.compose.service'],
    networkMode: c.HostConfig?.NetworkMode,
  };
}

function parseStatsSample(stats: Docker.ContainerStats): ContainerStatsSample {
  const cpuDelta =
    (stats.cpu_stats?.cpu_usage?.total_usage || 0) - (stats.precpu_stats?.cpu_usage?.total_usage || 0);
  const systemDelta =
    (stats.cpu_stats?.system_cpu_usage || 0) - (stats.precpu_stats?.system_cpu_usage || 0);
  const cpuCount =
    stats.cpu_stats?.online_cpus || stats.cpu_stats?.cpu_usage?.percpu_usage?.length || 1;
  const cpuPercent = systemDelta > 0 ? (cpuDelta / systemDelta) * cpuCount * 100 : 0;

  let netRx = 0;
  let netTx = 0;
  for (const n of Object.values(stats.networks || {})) {
    netRx += n.rx_bytes || 0;
    netTx += n.tx_bytes || 0;
  }

  let blockRead = 0;
  let blockWrite = 0;
  for (const b of stats.blkio_stats?.io_service_bytes_recursive || []) {
    if (b.op?.toLowerCase() === 'read') blockRead += b.value || 0;
    if (b.op?.toLowerCase() === 'write') blockWrite += b.value || 0;
  }

  const memUsage = stats.memory_stats?.usage || 0;
  const memLimit = stats.memory_stats?.limit || 0;
  return {
    cpuPercent: Math.max(0, Math.min(cpuPercent, 100 * cpuCount)),
    memUsage,
    memLimit,
    memPercent: memLimit > 0 ? (memUsage / memLimit) * 100 : 0,
    netRx,
    netTx,
    blockRead,
    blockWrite,
    ts: Date.now(),
  };
}

export class DockerConnectionManager {
  private connections = new Map<string, ManagedConnection>();
  private configPath: string;
  private groupsPath: string;

  constructor(userDataDir: string) {
    this.configPath = path.join(userDataDir, 'docker-connections.json');
    this.groupsPath = path.join(userDataDir, 'docker-groups.json');
    fs.mkdirSync(userDataDir, { recursive: true });
  }

  // ---------- persistence ----------
  loadConfigs(): DockerConnectionConfig[] {
    try {
      if (!fs.existsSync(this.configPath)) return [];
      const raw = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }

  private saveConfigs(list: DockerConnectionConfig[]) {
    fs.writeFileSync(this.configPath, JSON.stringify(list, null, 2), 'utf8');
  }

  listConfigs(): DockerConnectionConfig[] {
    return this.loadConfigs();
  }

  upsertConfig(cfg: DockerConnectionConfig): DockerConnectionConfig {
    const list = this.loadConfigs();
    const idx = list.findIndex((c) => c.id === cfg.id);
    if (idx >= 0) list[idx] = cfg;
    else list.push(cfg);
    this.saveConfigs(list);
    return cfg;
  }

  removeConfig(id: string) {
    const list = this.loadConfigs().filter((c) => c.id !== id);
    this.saveConfigs(list);
    void this.disconnect(id);
  }

  // ---------- sidebar groups ----------
  loadGroups(): ConnectionGroup[] {
    try {
      if (!fs.existsSync(this.groupsPath)) return [];
      const raw = JSON.parse(fs.readFileSync(this.groupsPath, 'utf8'));
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }

  private saveGroups(list: ConnectionGroup[]) {
    fs.writeFileSync(this.groupsPath, JSON.stringify(list, null, 2), 'utf8');
  }

  listGroups(): ConnectionGroup[] {
    return this.loadGroups();
  }

  upsertGroup(group: ConnectionGroup): ConnectionGroup {
    const list = this.loadGroups();
    const idx = list.findIndex((g) => g.id === group.id);
    if (idx >= 0) list[idx] = group;
    else list.push(group);
    this.saveGroups(list);
    return group;
  }

  /** Remove a folder; its connections fall back to root (groupId cleared). */
  removeGroup(id: string) {
    this.saveGroups(this.loadGroups().filter((g) => g.id !== id));
    const list = this.loadConfigs();
    let changed = false;
    for (const c of list) {
      if (c.groupId === id) {
        delete c.groupId;
        changed = true;
      }
    }
    if (changed) this.saveConfigs(list);
  }

  // ---------- runtime ----------
  private async buildDocker(cfg: DockerConnectionConfig): Promise<{ docker: Docker; tunnel?: SshTunnel }> {
    if (cfg.kind === 'unix') {
      return { docker: new Docker({ socketPath: cfg.socketPath || '/var/run/docker.sock' }) };
    }

    if (cfg.kind === 'tcp') {
      const opts: Docker.DockerOptions = {
        host: cfg.host || '127.0.0.1',
        port: cfg.port || 2375,
        protocol: cfg.tls ? 'https' : 'http',
      };
      if (cfg.tls) {
        const ca = readCert(cfg.ca, cfg.caCertPath);
        const cert = readCert(cfg.cert, cfg.certPath);
        const key = readCert(cfg.key, cfg.keyPath);
        if (ca) opts.ca = ca;
        if (cert) opts.cert = cert;
        if (key) opts.key = key;
      }
      return { docker: new Docker(opts) };
    }

    // ssh
    const tunnel = await createSshDockerTunnel(
      {
        host: cfg.sshHost || '',
        port: cfg.sshPort || 22,
        username: cfg.sshUser || 'root',
        password: cfg.sshPassword,
        privateKeyPath: cfg.sshPrivateKeyPath,
        passphrase: cfg.sshPassphrase,
      },
      cfg.dockerSocketPath || '/var/run/docker.sock'
    );
    return {
      docker: new Docker({ host: '127.0.0.1', port: tunnel.localPort, protocol: 'http' }),
      tunnel,
    };
  }

  async connect(id: string): Promise<ConnectionStatus> {
    const cfg = this.loadConfigs().find((c) => c.id === id);
    if (!cfg) throw new Error(`未找到连接配置: ${id}`);

    await this.disconnect(id);

    try {
      const { docker, tunnel } = await this.buildDocker(cfg);
      const info = await this.fetchInfo(docker);
      const managed: ManagedConnection = {
        config: cfg,
        docker,
        tunnel,
        status: { id, connected: true, info },
      };
      this.connections.set(id, managed);
      return managed.status;
    } catch (e) {
      const status: ConnectionStatus = {
        id,
        connected: false,
        error: e instanceof Error ? e.message : String(e),
      };
      this.connections.set(id, {
        config: cfg,
        docker: null as unknown as Docker,
        status,
      });
      return status;
    }
  }

  async disconnect(id: string) {
    const m = this.connections.get(id);
    if (!m) return;
    if (m.tunnel) {
      try {
        await m.tunnel.close();
      } catch {
        /* ignore */
      }
    }
    this.connections.delete(id);
  }

  async disconnectAll() {
    for (const id of [...this.connections.keys()]) {
      await this.disconnect(id);
    }
  }

  status(id: string): ConnectionStatus | undefined {
    return this.connections.get(id)?.status;
  }

  listStatuses(): ConnectionStatus[] {
    return [...this.connections.values()].map((m) => m.status);
  }

  private dockerOf(id: string): Docker {
    const m = this.connections.get(id);
    if (!m || !m.status.connected || !m.docker) {
      throw new Error(`未连接到主机: ${id}`);
    }
    return m.docker;
  }

  async testConfig(cfg: DockerConnectionConfig): Promise<{ ok: boolean; info?: DockerInfoLite; error?: string }> {
    let tunnel: SshTunnel | undefined;
    try {
      const built = await this.buildDocker(cfg);
      tunnel = built.tunnel;
      const info = await this.fetchInfo(built.docker);
      return { ok: true, info };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    } finally {
      if (tunnel) {
        try {
          await tunnel.close();
        } catch {
          /* ignore */
        }
      }
    }
  }

  private async fetchInfo(docker: Docker): Promise<DockerInfoLite> {
    const info = await docker.info();
    return {
      name: info.Name,
      serverVersion: info.ServerVersion,
      os: info.OperatingSystem,
      arch: info.Architecture,
      nCPU: info.NCPU,
      memTotal: info.MemTotal,
      containers: info.Containers,
      containersRunning: info.ContainersRunning,
      containersPaused: info.ContainersPaused,
      containersStopped: info.ContainersStopped,
      images: info.Images,
      driver: info.Driver,
    };
  }

  // ---------- containers ----------
  async listContainers(hostId: string, all = true): Promise<ContainerSummary[]> {
    const docker = this.dockerOf(hostId);
    const list = await docker.listContainers({ all, size: false });
    return list.map(toSummary);
  }

  async inspectContainer(hostId: string, id: string): Promise<ContainerDetail> {
    const docker = this.dockerOf(hostId);
    const c = await docker.getContainer(id).inspect();
    const labels = c.Config?.Labels || {};
    const ports = Object.entries(c.NetworkSettings?.Ports || {}).flatMap(([key, binds]) => {
      const [privatePort, type] = key.split('/');
      return (binds || []).map((b) => ({
        ip: b.HostIp,
        privatePort: Number(privatePort),
        publicPort: Number(b.HostPort),
        type: type || 'tcp',
      }));
    });

    let cpuPercent = 0;
    let memUsage = 0;
    let memLimit = 0;
    let netRx = 0;
    let netTx = 0;
    let blockRead = 0;
    let blockWrite = 0;
    try {
      const stats = await new Promise<Docker.ContainerStats>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('获取资源统计超时')), 4000);
        docker
          .getContainer(id)
          .stats({ stream: false }, (err, s) => {
            clearTimeout(t);
            if (err) reject(err);
            else resolve(s as Docker.ContainerStats);
          });
      });
      const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
      const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
      const cpuCount = stats.cpu_stats.online_cpus || stats.cpu_stats.cpu_usage.percpu_usage?.length || 1;
      cpuPercent = systemDelta > 0 ? (cpuDelta / systemDelta) * cpuCount * 100 : 0;
      memUsage = stats.memory_stats.usage || 0;
      memLimit = stats.memory_stats.limit || 0;
      for (const n of Object.values(stats.networks || {})) {
        netRx += n.rx_bytes || 0;
        netTx += n.tx_bytes || 0;
      }
      const bio = stats.blkio_stats?.io_service_bytes_recursive || [];
      for (const b of bio) {
        if (b.op?.toLowerCase() === 'read') blockRead += b.value || 0;
        if (b.op?.toLowerCase() === 'write') blockWrite += b.value || 0;
      }
    } catch {
      /* stats optional */
    }

    return {
      id: c.Id,
      name: (c.Name || '').replace(/^\//, ''),
      image: c.Config?.Image || '',
      imageId: c.Image || '',
      state: c.State?.Status || '',
      status: c.State?.Status || '',
      created: Math.floor(new Date(c.Created).getTime() / 1000),
      ports,
      labels,
      composeProject: labels['com.docker.compose.project'],
      composeService: labels['com.docker.compose.service'],
      command: Array.isArray(c.Config?.Cmd) ? c.Config.Cmd.join(' ') : c.Config?.Cmd || '',
      env: c.Config?.Env || [],
      mounts: (c.Mounts || []).map((m) => ({
        type: m.Type,
        source: m.Source,
        destination: m.Destination,
      })),
      networks: Object.keys(c.NetworkSettings?.Networks || {}),
      restartCount: c.RestartCount,
      restartPolicy: (c.HostConfig?.RestartPolicy?.Name || 'no') as ContainerDetail['restartPolicy'],
      startedAt: c.State?.StartedAt,
      finishedAt: c.State?.FinishedAt,
      exitCode: c.State?.ExitCode,
      oomKilled: c.State?.OOMKilled,
      platform: c.Platform,
      hostname: c.Config?.Hostname,
      workingDir: c.Config?.WorkingDir,
      cpuPercent,
      memUsage,
      memLimit,
      netRx,
      netTx,
      blockRead,
      blockWrite,
    };
  }

  async startContainer(hostId: string, id: string) {
    await this.dockerOf(hostId).getContainer(id).start();
  }

  async stopContainer(hostId: string, id: string) {
    await this.dockerOf(hostId).getContainer(id).stop({ t: 5 });
  }

  async restartContainer(hostId: string, id: string) {
    await this.dockerOf(hostId).getContainer(id).restart({ t: 5 });
  }

  async killContainer(hostId: string, id: string) {
    await this.dockerOf(hostId).getContainer(id).kill();
  }

  /** Change restart policy without recreating the container. */
  async updateRestartPolicy(
    hostId: string,
    id: string,
    policy: 'no' | 'always' | 'on-failure' | 'unless-stopped',
    maximumRetryCount = 0
  ) {
    await this.dockerOf(hostId)
      .getContainer(id)
      .update({
        RestartPolicy: {
          Name: policy,
          MaximumRetryCount: policy === 'on-failure' ? maximumRetryCount : 0,
        },
      });
  }

  /**
   * Break a fault-restart loop: disable auto-restart, then stop (kill if stop hangs).
   * Returns the action taken: 'stopped' | 'killed' | 'already-stopped'.
   */
  async stopRestartLoop(hostId: string, id: string): Promise<'stopped' | 'killed' | 'already-stopped'> {
    const container = this.dockerOf(hostId).getContainer(id);
    await this.updateRestartPolicy(hostId, id, 'no');
    const info = await container.inspect();
    const state = info.State?.Status || '';
    if (state === 'exited' || state === 'created' || state === 'dead' || state === 'removing') {
      return 'already-stopped';
    }
    try {
      await container.stop({ t: 3 });
      return 'stopped';
    } catch {
      await container.kill();
      return 'killed';
    }
  }

  async removeContainer(hostId: string, id: string, force = false) {
    await this.dockerOf(hostId).getContainer(id).remove({ force, v: true });
  }

  async pauseContainer(hostId: string, id: string) {
    await this.dockerOf(hostId).getContainer(id).pause();
  }

  async unpauseContainer(hostId: string, id: string) {
    await this.dockerOf(hostId).getContainer(id).unpause();
  }

  /** Create (and optionally start) a container. Returns the new container id. */
  async createContainer(hostId: string, opts: CreateContainerOptions, start = true): Promise<string> {
    const docker = this.dockerOf(hostId);
    const image = opts.image?.trim();
    if (!image) throw new Error('镜像名称不能为空');

    const exposedPorts: Record<string, Record<string, never>> = {};
    const portBindings: Record<string, { HostIp?: string; HostPort: string }[]> = {};
    for (const p of opts.ports || []) {
      const key = `${p.privatePort}/${p.type || 'tcp'}`;
      exposedPorts[key] = {};
      if (p.publicPort && p.publicPort > 0) {
        portBindings[key] = [
          {
            HostIp: p.hostIp && p.hostIp !== '0.0.0.0' ? p.hostIp : undefined,
            HostPort: String(p.publicPort),
          },
        ];
      }
    }

    const binds: string[] = [];
    for (const v of opts.volumes || []) {
      const src = v.source?.trim();
      const dst = v.destination?.trim();
      if (!src || !dst) continue;
      binds.push(v.readOnly ? `${src}:${dst}:ro` : `${src}:${dst}`);
    }

    const labels: Record<string, string> = {};
    for (const [k, v] of Object.entries(opts.labels || {})) {
      if (k) labels[k] = v ?? '';
    }

    const createOpts: Docker.ContainerCreateOptions = {
      Image: image,
      name: opts.name?.trim() || undefined,
      Cmd: opts.cmd && opts.cmd.length > 0 ? opts.cmd : undefined,
      Entrypoint: opts.entrypoint && opts.entrypoint.length > 0 ? opts.entrypoint : undefined,
      Env: opts.env && opts.env.length > 0 ? opts.env : undefined,
      WorkingDir: opts.workingDir?.trim() || undefined,
      User: opts.user?.trim() || undefined,
      Hostname: opts.hostname?.trim() || undefined,
      Labels: Object.keys(labels).length ? labels : undefined,
      Tty: opts.tty ?? true,
      OpenStdin: opts.stdinOpen ?? true,
      ExposedPorts: Object.keys(exposedPorts).length ? exposedPorts : undefined,
      HostConfig: {
        PortBindings: Object.keys(portBindings).length ? portBindings : undefined,
        Binds: binds.length ? binds : undefined,
        NetworkMode: opts.network?.trim() || undefined,
        RestartPolicy: opts.restartPolicy
          ? { Name: opts.restartPolicy, MaximumRetryCount: opts.restartPolicy === 'on-failure' ? 3 : 0 }
          : undefined,
        AutoRemove: opts.autoRemove ?? false,
        Privileged: opts.privileged ?? false,
      },
    };

    const container = await docker.createContainer(createOpts);
    if (start) await container.start();
    return container.id;
  }

  async createNetwork(hostId: string, opts: CreateNetworkOptions): Promise<string> {
    const docker = this.dockerOf(hostId);
    const name = opts.name?.trim();
    if (!name) throw new Error('网络名称不能为空');

    const labels: Record<string, string> = {};
    for (const [k, v] of Object.entries(opts.labels || {})) {
      if (k) labels[k] = v ?? '';
    }

    const createOpts: Docker.NetworkCreateOptions = {
      Name: name,
      Driver: opts.driver?.trim() || 'bridge',
      Internal: opts.internal ?? false,
      Attachable: opts.attachable ?? false,
      Labels: Object.keys(labels).length ? labels : undefined,
    };

    const subnet = opts.subnet?.trim();
    const gateway = opts.gateway?.trim();
    if (subnet) {
      createOpts.IPAM = {
        Driver: 'default',
        Config: [{ Subnet: subnet, Gateway: gateway || undefined }],
      };
    }

    const res = await docker.createNetwork(createOpts);
    return res.id;
  }

  async createVolume(hostId: string, opts: CreateVolumeOptions): Promise<string> {
    const docker = this.dockerOf(hostId);
    const name = opts.name?.trim();
    if (!name) throw new Error('数据卷名称不能为空');

    const labels: Record<string, string> = {};
    for (const [k, v] of Object.entries(opts.labels || {})) {
      if (k) labels[k] = v ?? '';
    }

    const vol = await docker.createVolume({
      Name: name,
      Driver: opts.driver?.trim() || 'local',
      Labels: Object.keys(labels).length ? labels : undefined,
    });
    return vol.Name || name;
  }

  /** One-shot container stats (CPU / mem / net / block I/O). */
  async containerStats(hostId: string, id: string): Promise<ContainerStatsSample> {
    const docker = this.dockerOf(hostId);
    const stats = await new Promise<Docker.ContainerStats>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('获取资源统计超时')), 5000);
      docker
        .getContainer(id)
        .stats({ stream: false }, (err, s) => {
          clearTimeout(t);
          if (err) reject(err);
          else resolve(s as Docker.ContainerStats);
        });
    });
    return parseStatsSample(stats);
  }

  /**
   * Stream container stats. Returns an abort function.
   * Samples are delivered via `onSample`; parse errors are ignored.
   */
  streamContainerStats(
    hostId: string,
    id: string,
    onSample: (s: ContainerStatsSample) => void,
    onError?: (e: Error) => void
  ): () => void {
    const docker = this.dockerOf(hostId);
    let stream: NodeJS.ReadableStream | null = null;
    let closed = false;

    docker
      .getContainer(id)
      .stats({ stream: true }, (err: Error | null, s?: NodeJS.ReadableStream) => {
        if (closed) return;
        if (err || !s) {
          onError?.(err || new Error('资源统计流不可用'));
          return;
        }
        stream = s;
        s.on('data', (buf: Buffer) => {
          // dockerode may deliver one JSON object per chunk (or several)
          const text = buf.toString('utf8');
          for (const line of text.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const parsed = JSON.parse(trimmed) as Docker.ContainerStats;
              onSample(parseStatsSample(parsed));
            } catch {
              /* partial chunk — ignore */
            }
          }
        });
        s.on('error', (e: Error) => {
          if (!closed) onError?.(e);
        });
      });

    return () => {
      closed = true;
      try {
        (stream as { destroy?: () => void } | null)?.destroy?.();
        stream?.removeAllListeners?.();
      } catch {
        /* ignore */
      }
    };
  }

  /**
   * Subscribe to Docker events for this host. Returns an abort function.
   * Reconnects once on stream end so long-lived apps stay live.
   */
  streamEvents(hostId: string, onEvent: (e: DockerEvent) => void, onError?: (e: Error) => void): () => void {
    const docker = this.dockerOf(hostId);
    let aborted = false;
    let stream: NodeJS.ReadableStream | null = null;
    let reconnectTimer: NodeJS.Timeout | null = null;

    const attach = () => {
      if (aborted) return;
      docker.getEvents({}, (err: Error | null, s?: NodeJS.ReadableStream) => {
        if (aborted) return;
        if (err || !s) {
          onError?.(err || new Error('事件流不可用'));
          return;
        }
        stream = s;
        s.on('data', (buf: Buffer) => {
          const text = buf.toString('utf8');
          for (const line of text.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const raw = JSON.parse(trimmed) as {
                Type?: string;
                Action?: string;
                id?: string;
                Actor?: { ID?: string; Attributes?: Record<string, string> };
                time?: number;
                timeNano?: number;
              };
              const attrs = raw.Actor?.Attributes || {};
              onEvent({
                hostId,
                type: raw.Type || 'unknown',
                action: raw.Action || 'unknown',
                id: raw.id || raw.Actor?.ID,
                name: attrs.name,
                image: attrs.image,
                attributes: attrs,
                time: raw.time || Math.floor((raw.timeNano || Date.now() * 1e6) / 1e9),
              });
            } catch {
              /* ignore partial */
            }
          }
        });
        s.on('error', (e: Error) => {
          if (!aborted) onError?.(e);
        });
        s.on('end', () => {
          if (aborted) return;
          // brief backoff then re-attach
          reconnectTimer = setTimeout(attach, 1500);
        });
      });
    };

    attach();

    return () => {
      aborted = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try {
        (stream as { destroy?: () => void } | null)?.destroy?.();
        stream?.removeAllListeners?.();
      } catch {
        /* ignore */
      }
    };
  }

  /**
   * Returns a Node readable stream of raw container logs (Docker multiplexed frames).
   * Uses the callback form of dockerode.logs() — the promise form resolves to a
   * Buffer (follow:false) or a stream that callers often forget to await.
   */
  containerLogStream(
    hostId: string,
    id: string,
    opts?: { tail?: number; follow?: boolean; since?: number }
  ): Promise<NodeJS.ReadableStream> {
    const docker = this.dockerOf(hostId);
    const follow = opts?.follow ?? true;
    return new Promise((resolve, reject) => {
      const logOpts = {
        stdout: true,
        stderr: true,
        tail: opts?.tail ?? 200,
        since: opts?.since ?? 0,
        timestamps: true,
        follow,
      };
      // Callback form: (err, stream) when follow=true, (err, buffer) when follow=false
      docker.getContainer(id).logs(logOpts as never, (err: Error | null, result?: Buffer | NodeJS.ReadableStream) => {
        if (err) return reject(err);
        if (!result) return reject(new Error('Docker 日志流为空'));
        if (typeof (result as NodeJS.ReadableStream).on === 'function') {
          resolve(result as NodeJS.ReadableStream);
          return;
        }
        // follow:false returns a Buffer — wrap it as a one-shot stream
        const buf = result as Buffer;
        const rs = Readable.from(buf);
        resolve(rs);
      });
    });
  }

  async createExec(hostId: string, containerId: string, cmd: string[], user = '', workdir = '') {
    const docker = this.dockerOf(hostId);
    return docker.getContainer(containerId).exec({
      Cmd: cmd,
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: true,
      User: user,
      WorkingDir: workdir,
    });
  }

  startExec(execId: string, hostId: string): Promise<NodeJS.ReadWriteStream> {
    const docker = this.dockerOf(hostId);
    const exec = docker.getExec(execId);
    return new Promise((resolve, reject) => {
      exec.start({ hijack: true, stdin: true, Tty: true }, (err: Error | null, stream?: NodeJS.ReadWriteStream) => {
        if (err) return reject(err);
        if (!stream || typeof stream.on !== 'function') {
          return reject(new Error('Docker exec 未返回终端流'));
        }
        resolve(stream);
      });
    });
  }

  async resizeExec(execId: string, hostId: string, h: number, w: number) {
    const docker = this.dockerOf(hostId);
    await docker.getExec(execId).resize({ h, w });
  }

  // ---------- images ----------
  async listImages(hostId: string): Promise<ImageSummary[]> {
    const docker = this.dockerOf(hostId);
    const list = await docker.listImages({ all: false });
    return list.map((i) => ({
      id: i.Id,
      repoTags: i.RepoTags || [],
      repoDigests: i.RepoDigests || [],
      created: i.Created,
      size: i.Size,
      virtualSize: i.VirtualSize,
      labels: i.Labels || {},
    }));
  }

  async removeImage(hostId: string, id: string, force = false) {
    await this.dockerOf(hostId).getImage(id).remove({ force });
  }

  async pullImage(hostId: string, name: string, onProgress?: (msg: string) => void): Promise<void> {
    const docker = this.dockerOf(hostId);
    return new Promise((resolve, reject) => {
      docker.pull(name, (err: Error | null, stream?: NodeJS.ReadableStream) => {
        if (err || !stream) return reject(err || new Error('拉取镜像失败'));
        docker.modem.followProgress(
          stream,
          (e: Error | null) => (e ? reject(e) : resolve()),
          (event: { status?: string; progress?: string; id?: string }) => {
            onProgress?.(`${event.id || ''} ${event.status || ''} ${event.progress || ''}`.trim());
          }
        );
      });
    });
  }

  // ---------- networks / volumes ----------
  async listNetworks(hostId: string): Promise<NetworkSummary[]> {
    const docker = this.dockerOf(hostId);
    const nets = await docker.listNetworks();
    const result: NetworkSummary[] = [];
    for (const n of nets) {
      let detail: Docker.NetworkInspectInfo | undefined;
      try {
        detail = await docker.getNetwork(n.Id).inspect();
      } catch {
        /* ignore */
      }
      const ipam = detail?.IPAM?.Config?.[0];
      result.push({
        id: n.Id,
        name: n.Name,
        driver: n.Driver,
        scope: n.Scope,
        created: n.Created,
        internal: n.Internal,
        attachable: n.Attachable,
        ingress: n.Ingress,
        labels: n.Labels || {},
        subnet: ipam?.Subnet,
        gateway: ipam?.Gateway,
        containers: Object.entries(detail?.Containers || {}).map(([cid, c]) => ({
          name: c.Name || cid.slice(0, 12),
          ipv4: c.IPv4Address,
          ipv6: c.IPv6Address,
          mac: c.MacAddress,
        })),
      });
    }
    return result;
  }

  async removeNetwork(hostId: string, id: string) {
    await this.dockerOf(hostId).getNetwork(id).remove();
  }

  async listVolumes(hostId: string): Promise<VolumeSummary[]> {
    const docker = this.dockerOf(hostId);
    const res = await docker.listVolumes();
    return (res.Volumes || []).map((v) => ({
      name: v.Name,
      driver: v.Driver,
      mountpoint: v.Mountpoint,
      created: (v as { CreatedAt?: string }).CreatedAt || '',
      labels: v.Labels || {},
      scope: v.Scope,
      status: v.Status,
    }));
  }

  async removeVolume(hostId: string, name: string, force = false) {
    await this.dockerOf(hostId).getVolume(name).remove({ force });
  }

  // ---------- compose projects (derived from labels) ----------
  async listComposeProjects(hostId: string): Promise<ComposeProject[]> {
    const containers = await this.listContainers(hostId, true);
    const map = new Map<string, ComposeProject>();

    for (const c of containers) {
      const project = c.composeProject;
      if (!project) continue;
      let p = map.get(project);
      if (!p) {
        p = { name: project, services: [], containers: [], running: 0, total: 0 };
        map.set(project, p);
      }
      p.containers.push(c);
      p.total += 1;
      if (c.state === 'running') p.running += 1;

      const svcName = c.composeService || c.name;
      const existing = p.services.find((s) => s.name === svcName);
      if (existing) {
        existing.replicas = (existing.replicas || 1) + 1;
      } else {
        const svc: ComposeService = {
          name: svcName,
          containerId: c.id,
          containerName: c.name,
          state: c.state,
          status: c.status,
          image: c.image,
          replicas: 1,
        };
        p.services.push(svc);
      }
    }

    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async listUnclassifiedContainers(hostId: string): Promise<ContainerSummary[]> {
    const containers = await this.listContainers(hostId, true);
    return containers.filter((c) => !c.composeProject);
  }

  // ---------- stats ----------
  async systemStats(hostId: string): Promise<SystemStats> {
    const docker = this.dockerOf(hostId);
    const [info, containers, images, volumes, networks] = await Promise.all([
      docker.info(),
      docker.listContainers({ all: true }),
      docker.listImages(),
      docker.listVolumes(),
      docker.listNetworks(),
    ]);

    let cpuPercent = 0;
    let memUsage = 0;
    let memLimit = info.MemTotal || 0;
    let netRx = 0;
    let netTx = 0;
    let blockRead = 0;
    let blockWrite = 0;

    for (const c of containers) {
      if (c.State !== 'running') continue;
      try {
        const stats = await new Promise<Docker.ContainerStats>((resolve, reject) => {
          const t = setTimeout(() => reject(new Error('操作超时')), 3000);
          docker
            .getContainer(c.Id)
            .stats({ stream: false }, (err, s) => {
              clearTimeout(t);
              if (err) reject(err);
              else resolve(s as Docker.ContainerStats);
            });
        });
        const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
        const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
        const cpuCount = stats.cpu_stats.online_cpus || stats.cpu_stats.cpu_usage.percpu_usage?.length || 1;
        if (systemDelta > 0) cpuPercent += (cpuDelta / systemDelta) * cpuCount * 100;
        memUsage += stats.memory_stats.usage || 0;
        for (const n of Object.values(stats.networks || {})) {
          netRx += n.rx_bytes || 0;
          netTx += n.tx_bytes || 0;
        }
        for (const b of stats.blkio_stats?.io_service_bytes_recursive || []) {
          if (b.op?.toLowerCase() === 'read') blockRead += b.value || 0;
          if (b.op?.toLowerCase() === 'write') blockWrite += b.value || 0;
        }
      } catch {
        /* skip */
      }
    }

    return {
      cpuPercent: Math.min(cpuPercent, 100),
      memUsage,
      memLimit,
      memPercent: memLimit > 0 ? (memUsage / memLimit) * 100 : 0,
      netRx,
      netTx,
      blockRead,
      blockWrite,
      containersRunning: containers.filter((c) => c.State === 'running').length,
      containersTotal: containers.length,
      images: (images || []).length,
      volumes: volumes.Volumes?.length || 0,
      networks: (networks || []).length,
    };
  }
}
