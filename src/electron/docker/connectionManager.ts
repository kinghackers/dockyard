import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
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
  ImageDetail,
  ImageSummary,
  NetworkSummary,
  SystemStats,
  VolumeSummary,
} from './types';
import { createSshDockerTunnel, SshTunnel } from './sshTunnel';
import { readJsonStore, writeJsonStore } from './configStore';
import { runComposeCommand } from './composeRunner';
import * as imageOps from './imageOps';
import { extractFirstEntry, packSingleFile, readStreamToEnd } from './tar';
import {
  decryptSecret,
  encryptSecret,
  encryptionAvailable,
  hasPlaintextSecret,
} from './secrets';

const SECRET_FIELDS = ['sshPassword', 'sshPassphrase', 'key', 'cert'] as const;

function secretValues(cfg: DockerConnectionConfig): (string | undefined)[] {
  return SECRET_FIELDS.map((f) => cfg[f]);
}

/** Decrypt secrets for runtime use. */
function decryptConfig(cfg: DockerConnectionConfig): DockerConnectionConfig {
  return {
    ...cfg,
    sshPassword: decryptSecret(cfg.sshPassword),
    sshPassphrase: decryptSecret(cfg.sshPassphrase),
    key: decryptSecret(cfg.key),
    cert: decryptSecret(cfg.cert),
  };
}

/** Encrypt secrets before writing to disk. */
function encryptConfig(cfg: DockerConnectionConfig): DockerConnectionConfig {
  return {
    ...cfg,
    sshPassword: encryptSecret(cfg.sshPassword),
    sshPassphrase: encryptSecret(cfg.sshPassphrase),
    key: encryptSecret(cfg.key),
    cert: encryptSecret(cfg.cert),
  };
}

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
      publicPort: p.PublicPort || undefined,
      type: p.Type,
    })),
    labels,
    composeProject: labels['com.docker.compose.project'],
    composeService: labels['com.docker.compose.service'],
    networkMode: c.HostConfig?.NetworkMode,
  };
}

/** Convert HostConfig.PortBindings into summary port entries. */
function portsFromBindings(
  bindings: Record<string, { HostIp?: string; HostPort?: string }[] | null> | undefined
): ContainerSummary['ports'] {
  return Object.entries(bindings || {}).flatMap(([key, binds]) => {
    const [privatePort, type] = key.split('/');
    return (binds || []).map((b) => ({
      ip: b.HostIp || undefined,
      privatePort: Number(privatePort),
      publicPort: b.HostPort ? Number(b.HostPort) : undefined,
      type: type || 'tcp',
    }));
  });
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
  private connecting = new Map<string, { epoch: number; p: Promise<ConnectionStatus> }>();
  /** bumped on every disconnect — lets an in-flight connect detect cancellation */
  private epoch = new Map<string, number>();
  private configPath: string;
  private groupsPath: string;

  constructor(userDataDir: string) {
    this.configPath = path.join(userDataDir, 'docker-connections.json');
    this.groupsPath = path.join(userDataDir, 'docker-groups.json');
    fs.mkdirSync(userDataDir, { recursive: true });
  }

  // ---------- persistence ----------
  private configLoadError: string | null = null;

  /** Last config-load failure + whether at-rest encryption is available, for UI warnings. */
  configHealth(): { loadError: string | null; encryptionAvailable: boolean } {
    return { loadError: this.configLoadError, encryptionAvailable: encryptionAvailable() };
  }

  loadConfigs(): DockerConnectionConfig[] {
    // NOTE: readJsonStore never silently treats a *corrupt* file as empty —
    // it moves it aside and reports it, so a save cannot wipe user data.
    const { value, corruptedBackup } = readJsonStore<DockerConnectionConfig[]>(this.configPath);
    this.configLoadError = corruptedBackup
      ? `连接配置文件已损坏，原文件备份于 ${corruptedBackup}。为避免覆盖，已从空配置启动，可手动恢复该备份。`
      : null;
    if (!value) return [];
    const raw = value;
    if (!Array.isArray(raw)) return [];
    const list = raw.map((c: DockerConnectionConfig) => decryptConfig(c));

    // one-shot upgrade: rewrite legacy plaintext secrets as encrypted blobs
    if (encryptionAvailable() && raw.some((c: DockerConnectionConfig) => hasPlaintextSecret(secretValues(c)))) {
      try {
        this.saveConfigs(list);
      } catch {
        /* keep using in-memory plaintext if rewrite fails */
      }
    }
    return list;
  }

  private saveConfigs(list: DockerConnectionConfig[]) {
    writeJsonStore(this.configPath, list.map(encryptConfig));
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
    const { value } = readJsonStore<ConnectionGroup[]>(this.groupsPath);
    return Array.isArray(value) ? value : [];
  }

  private saveGroups(list: ConnectionGroup[]) {
    writeJsonStore(this.groupsPath, list);
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
    // concurrent connects for one id (double-click, renderer retry) would each
    // build a tunnel and the loser would overwrite+leak the winner's — dedupe.
    // A disconnect since the in-flight attempt started invalidates it (it will
    // resolve as cancelled); the caller's intent is then a fresh connect.
    const inFlight = this.connecting.get(id);
    if (inFlight && inFlight.epoch === (this.epoch.get(id) || 0)) return inFlight.p;
    const entry: { epoch: number; p: Promise<ConnectionStatus> } = {
      epoch: this.epoch.get(id) || 0,
      p: null as unknown as Promise<ConnectionStatus>,
    };
    entry.p = this.doConnect(id).finally(() => {
      if (this.connecting.get(id) === entry) this.connecting.delete(id);
    });
    this.connecting.set(id, entry);
    return entry.p;
  }

  private async doConnect(id: string): Promise<ConnectionStatus> {
    const cfg = this.loadConfigs().find((c) => c.id === id);
    if (!cfg) throw new Error(`未找到连接配置: ${id}`);

    await this.disconnect(id);
    // capture AFTER the disconnect above (which bumps the epoch itself)
    const myEpoch = this.epoch.get(id) || 0;

    // keep the tunnel reachable from the catch — if fetchInfo fails after the
    // tunnel is up, it must be closed or the ssh2 client + local listener leak
    let tunnel: SshTunnel | undefined;
    try {
      const built = await this.buildDocker(cfg);
      tunnel = built.tunnel;
      const docker = built.docker;
      const info = await this.fetchInfo(docker);
      if ((this.epoch.get(id) || 0) !== myEpoch) {
        // disconnect() raced this connect — honor it instead of resurrecting.
        // No `error` field: a cancelled connect is not a failure (an error
        // here would re-arm the renderer's auto-reconnect and undo the
        // manual disconnect that cancelled us)
        try {
          await tunnel?.close();
        } catch {
          /* ignore */
        }
        return { id, connected: false };
      }
      const managed: ManagedConnection = {
        config: cfg,
        docker,
        tunnel,
        status: { id, connected: true, info },
      };
      this.connections.set(id, managed);
      return managed.status;
    } catch (e) {
      if (tunnel) {
        try {
          await tunnel.close();
        } catch {
          /* ignore */
        }
      }
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
    this.epoch.set(id, (this.epoch.get(id) || 0) + 1);
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
    // also cancel in-flight connects for hosts not yet registered (e.g. quit
    // during a first-ever connect) or they would register a tunnel nobody closes
    for (const id of this.connecting.keys()) {
      this.epoch.set(id, (this.epoch.get(id) || 0) + 1);
    }
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
  async listContainers(
    hostId: string,
    all = true,
    opts?: { enrichPorts?: boolean }
  ): Promise<ContainerSummary[]> {
    const docker = this.dockerOf(hostId);
    const list = await docker.listContainers({ all, size: false });
    const summaries = list.map(toSummary);

    // Opt-in: filling HostConfig port bindings for stopped containers costs
    // one inspect each — skip for dashboard/sidebar/event refresh paths.
    if (!opts?.enrichPorts) return summaries;

    await Promise.all(
      summaries.map(async (s, i) => {
        if (s.state === 'running' || s.state === 'paused') return;
        if (s.ports.some((p) => p.publicPort)) return;
        try {
          const inspect = await docker.getContainer(s.id).inspect();
          const fromBindings = portsFromBindings(inspect.HostConfig?.PortBindings);
          if (fromBindings.length > 0) summaries[i] = { ...s, ports: fromBindings };
        } catch {
          /* keep empty ports */
        }
      })
    );

    return summaries;
  }

  async inspectContainer(hostId: string, id: string): Promise<ContainerDetail> {
    const docker = this.dockerOf(hostId);
    const c = await docker.getContainer(id).inspect();
    const labels = c.Config?.Labels || {};
    const livePorts = Object.entries(c.NetworkSettings?.Ports || {}).flatMap(([key, binds]) => {
      const [privatePort, type] = key.split('/');
      return (binds || []).map((b) => ({
        ip: b.HostIp,
        privatePort: Number(privatePort),
        publicPort: b.HostPort ? Number(b.HostPort) : undefined,
        type: type || 'tcp',
      }));
    });
    const ports = livePorts.length > 0 ? livePorts : portsFromBindings(c.HostConfig?.PortBindings);

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
      health: c.State?.Health
        ? {
            status: c.State.Health.Status,
            failingStreak: c.State.Health.FailingStreak,
            log: (c.State.Health.Log || []).map((h) => ({
              exitCode: h.ExitCode,
              output: h.Output,
              start: h.Start,
              end: h.End,
            })),
          }
        : undefined,
      platform: c.Platform,
      hostname: c.Config?.Hostname,
      workingDir: c.Config?.WorkingDir,
      cpuPercent,
      memUsage,
      memLimit,
      memLimitConfigured: c.HostConfig?.Memory || undefined,
      nanoCpus: c.HostConfig?.NanoCpus || undefined,
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

  /** Rename a running or stopped container (docker rename). */
  async renameContainer(hostId: string, id: string, name: string) {
    if (!name.trim()) throw new Error('容器名称不能为空');
    await this.dockerOf(hostId).getContainer(id).rename({ name: name.trim() });
  }

  /** Update runtime resource limits (docker update): memory in MB, CPU as cores. */
  async updateContainerResources(
    hostId: string,
    id: string,
    opts: { memoryMB?: number; cpuCores?: number }
  ) {
    const update: { Memory?: number; NanoCpus?: number } = {};
    if (typeof opts.memoryMB === 'number' && opts.memoryMB > 0) {
      update.Memory = Math.round(opts.memoryMB * 1024 * 1024);
    }
    if (typeof opts.cpuCores === 'number' && opts.cpuCores > 0) {
      update.NanoCpus = Math.round(opts.cpuCores * 1e9);
    }
    if (Object.keys(update).length === 0) throw new Error('未指定要更新的资源限制');
    await this.dockerOf(hostId).getContainer(id).update(update);
  }

  /** Commit the container's current filesystem state as a new image (docker commit). */
  async commitContainer(
    hostId: string,
    id: string,
    opts: { repo: string; tag?: string; comment?: string }
  ): Promise<string> {
    if (!opts.repo.trim()) throw new Error('镜像仓库不能为空');
    const res = (await this.dockerOf(hostId).getContainer(id).commit({
      repo: opts.repo.trim(),
      tag: opts.tag?.trim() || 'latest',
      comment: opts.comment?.trim() || undefined,
    })) as { Id?: string };
    return res.Id || '';
  }

  /** Stream an image out as a tar (docker save) to the given file path. Returns bytes written. */
  async saveImageToFile(hostId: string, name: string, destPath: string): Promise<number> {
    return imageOps.saveImageToFile(this.dockerOf(hostId), name, destPath);
  }

  /** Load an image from a tar file (docker load). Returns daemon output. */
  async loadImageFromFile(hostId: string, filePath: string): Promise<string> {
    return imageOps.loadImageFromFile(this.dockerOf(hostId), filePath);
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
        if (closed) {
          // abort() ran while the request was in flight — destroy the late
          // response or the never-ending stats stream leaks its socket
          try {
            (s as { destroy?: () => void } | undefined)?.destroy?.();
          } catch {
            /* ignore */
          }
          return;
        }
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
    let retryDelay = 1500;

    // exponential backoff: an unreachable daemon should not be hammered every
    // 1.5s forever (resets once a stream comes back up). Guarded so an error
    // followed by end (or vice versa) only schedules one retry.
    const scheduleReconnect = () => {
      if (aborted || reconnectTimer) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        attach();
      }, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 30_000);
    };

    const attach = () => {
      if (aborted) return;
      docker.getEvents({}, (err: Error | null, s?: NodeJS.ReadableStream) => {
        if (aborted) {
          // abort() ran while the request was in flight — destroy the late
          // response or the /events stream leaks its socket
          try {
            (s as { destroy?: () => void } | undefined)?.destroy?.();
          } catch {
            /* ignore */
          }
          return;
        }
        if (err || !s) {
          onError?.(err || new Error('事件流不可用'));
          // a failed (re-)subscribe must retry too — tunnel/daemon errors
          // arrive here via the callback, not as stream 'error' events, and
          // dying here would kill auto-refresh forever
          scheduleReconnect();
          return;
        }
        // a late 'error' from the stream being replaced must not spawn a
        // second concurrent subscription — detach it first
        try {
          stream?.removeAllListeners?.();
          (stream as { destroy?: () => void } | null)?.destroy?.();
        } catch {
          /* ignore */
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
          // node streams do not emit 'end' after 'error' — a hard network
          // failure must schedule its own re-attach or refresh dies forever
          scheduleReconnect();
        });
        s.on('end', () => {
          if (aborted) return;
          scheduleReconnect();
        });
        // stream established — reset the backoff for the next drop
        retryDelay = 1500;
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

  /** Open an interactive shell on the SSH host behind this connection. */
  async openHostShellStream(hostId: string): Promise<NodeJS.ReadWriteStream> {
    const managed = this.connections.get(hostId);
    const tunnel = managed?.tunnel;
    if (!managed) throw new Error(`未找到连接配置: ${hostId}`);
    if (managed.config.kind !== 'ssh') {
      throw new Error('仅 SSH 连接支持主机终端');
    }
    if (!tunnel?.openShell) throw new Error('主机终端不可用：SSH 通道未就绪，请重新连接');

    const open = () =>
      new Promise<NodeJS.ReadWriteStream>((resolve, reject) => {
        tunnel.openShell!(120, 30, (err, stream) => {
          if (err || !stream) reject(err || new Error('主机 shell 不可用'));
          else resolve(stream);
        });
      });

    // rapid open/close sequences (e.g. dev-mode double mounts) can make the
    // server transiently reject a channel open — back off and retry
    const RETRIES = 3;
    for (let attempt = 1; ; attempt++) {
      try {
        return await open();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const transient = /channel open failure|open failed/i.test(msg);
        if (!transient || attempt >= RETRIES) throw err;
        await new Promise((r) => setTimeout(r, 350 * attempt));
      }
    }
  }

  // ---------- images ----------
  async listImages(hostId: string): Promise<ImageSummary[]> {
    return imageOps.listImages(this.dockerOf(hostId));
  }

  /** Image metadata + build history (layer commands). */
  async inspectImage(hostId: string, id: string): Promise<ImageDetail> {
    return imageOps.inspectImage(this.dockerOf(hostId), id);
  }

  async removeImage(hostId: string, id: string, force = false) {
    await imageOps.removeImage(this.dockerOf(hostId), id, force);
  }

  /** Add a repo:tag to an existing image. */
  async tagImage(hostId: string, id: string, repo: string, tag = 'latest') {
    await imageOps.tagImage(this.dockerOf(hostId), id, repo, tag);
  }

  // ---------- container files (docker cp-style via archive API) ----------

  /** Run a one-shot exec and collect its (Tty) text output. */
  private async execCollect(hostId: string, containerId: string, cmd: string[]): Promise<string> {
    const exec = await this.createExec(hostId, containerId, cmd);
    const stream = await this.startExec(exec.id, hostId);
    return await new Promise((resolve, reject) => {
      let out = '';
      stream.on('data', (b: Buffer) => {
        out += b.toString('utf8');
      });
      stream.on('error', reject);
      stream.on('end', () => resolve(out));
    });
  }

  /** List a directory inside a container; directories sort first. */
  async listContainerDir(
    hostId: string,
    id: string,
    dirPath: string
  ): Promise<{ path: string; entries: { name: string; dir: boolean }[] }> {
    const norm = (dirPath.trim() || '/').replace(/\\/g, '/').replace(/\/+$/, '') || '/';
    const quoted = `'${norm.replace(/'/g, `'\\''`)}'`;
    const out = await this.execCollect(hostId, id, ['sh', '-c', `ls -1Ap -- ${quoted} 2>&1 || true`]);
    if (/cannot access|No such file/i.test(out)) {
      throw new Error(`目录不存在或不可读：${norm}`);
    }
    const entries = out
      .split('\n')
      .map((l) => l.replace(/\r$/, '').trim())
      .filter((l) => l.length > 0 && !l.startsWith('ls:'))
      .map((l) => ({ name: l.replace(/\/$/, ''), dir: l.endsWith('/') }));
    entries.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
    return { path: norm, entries };
  }

  /** Download a single file from a container to a local path. Returns bytes. */
  async downloadContainerFile(
    hostId: string,
    id: string,
    filePath: string,
    destPath: string
  ): Promise<number> {
    const archive = (await this.dockerOf(hostId)
      .getContainer(id)
      .getArchive({ path: filePath })) as NodeJS.ReadableStream;
    const tarBuf = await readStreamToEnd(archive);
    const { data } = extractFirstEntry(tarBuf);
    fs.writeFileSync(destPath, data);
    return data.length;
  }

  /** Upload a local file into a container directory. */
  async uploadFileToContainer(
    hostId: string,
    id: string,
    localPath: string,
    destDir: string
  ): Promise<void> {
    const content = fs.readFileSync(localPath);
    const tar = packSingleFile(path.basename(localPath), content);
    await this.dockerOf(hostId)
      .getContainer(id)
      .putArchive(tar, { path: destDir === '/' ? '/' : destDir.replace(/\/+$/, '') });
  }

  // ---------- compose CLI ----------
  /**
   * Run `docker compose …` against the selected connection.
   * Needs the Docker CLI on PATH. TLS material is staged to a temp dir when inline.
   */
  async runCompose(
    hostId: string,
    args: string[],
    opts?: { cwd?: string; timeoutMs?: number }
  ): Promise<{ ok: boolean; output: string; exitCode: number | null }> {
    const cfg = this.loadConfigs().find((c) => c.id === hostId);
    if (!cfg) throw new Error(`未找到连接配置: ${hostId}`);
    return runComposeCommand(cfg, path.dirname(this.configPath), args, opts);
  }

  /** `docker compose -f <file> up -d` */
  async composeUp(hostId: string, filePath: string) {
    if (!filePath || !fs.existsSync(filePath)) {
      throw new Error(`找不到 compose 文件: ${filePath}`);
    }
    return this.runCompose(hostId, ['-f', filePath, 'up', '-d'], {
      cwd: path.dirname(filePath),
    });
  }

  /** `docker compose -f <file> down` (optional --volumes) */
  async composeFileDown(hostId: string, filePath: string, volumes = false) {
    if (!filePath || !fs.existsSync(filePath)) {
      throw new Error(`找不到 compose 文件: ${filePath}`);
    }
    return this.runCompose(
      hostId,
      ['-f', filePath, 'down', ...(volumes ? ['--volumes'] : [])],
      { cwd: path.dirname(filePath) }
    );
  }

  /** `docker compose -p <name> down` — tear down a running project by name. */
  async composeProjectDown(hostId: string, projectName: string, volumes = false) {
    const p = projectName.trim();
    if (!p) throw new Error('项目名不能为空');
    return this.runCompose(hostId, ['-p', p, 'down', ...(volumes ? ['--volumes'] : [])]);
  }

  /** `docker compose -p <name> pull` — refresh images for a running project. */
  async composeProjectPull(hostId: string, projectName: string) {
    const p = projectName.trim();
    if (!p) throw new Error('项目名不能为空');
    return this.runCompose(hostId, ['-p', p, 'pull']);
  }

  async pullImage(hostId: string, name: string, onProgress?: (msg: string) => void): Promise<void> {
    await imageOps.pullImage(this.dockerOf(hostId), name, onProgress);
  }

  /** Push an image tag to its registry (requires prior `docker login` on that host). */
  async pushImage(hostId: string, name: string, onProgress?: (msg: string) => void): Promise<void> {
    await imageOps.pushImage(this.dockerOf(hostId), name, onProgress);
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
  /** Disk usage summary for the cleanup wizard (docker system df). */
  async systemDf(
    hostId: string
  ): Promise<{
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
  }> {
    const df = (await this.dockerOf(hostId).df()) as {
      Images?: { Size?: number; RepoTags?: string[] }[];
      Containers?: { Size?: number; State?: string }[];
      Volumes?: { UsageData?: { Size?: number; RefCount?: number } }[];
    };
    const images = df.Images || [];
    const containers = df.Containers || [];
    const volumes = df.Volumes || [];
    const isDangling = (img: (typeof images)[number]) =>
      !img.RepoTags || img.RepoTags.length === 0 || img.RepoTags.every((t) => t === '<none>:<none>');
    const dangling = images.filter(isDangling);
    const stopped = containers.filter((c) => c.State !== 'running');
    const unused = volumes.filter((v) => (v.UsageData?.RefCount ?? 0) === 0);
    const danglingImageBytes = dangling.reduce((s, i) => s + (i.Size || 0), 0);
    const stoppedContainerBytes = stopped.reduce((s, c) => s + (c.Size || 0), 0);
    const unusedVolumeBytes = unused.reduce((s, v) => s + (v.UsageData?.Size || 0), 0);
    return {
      images: images.length,
      danglingImages: dangling.length,
      danglingImageBytes,
      containers: containers.length,
      stoppedContainers: stopped.length,
      stoppedContainerBytes,
      volumes: volumes.length,
      unusedVolumes: unused.length,
      unusedVolumeBytes,
      reclaimableBytes: danglingImageBytes + stoppedContainerBytes + unusedVolumeBytes,
    };
  }

  /** Prune dangling images / stopped containers / unused networks / volumes / build cache. */
  async pruneSystem(
    hostId: string,
    opts: {
      danglingImages?: boolean;
      stoppedContainers?: boolean;
      unusedNetworks?: boolean;
      unusedVolumes?: boolean;
      buildCache?: boolean;
    }
  ): Promise<{
    imagesDeleted: number;
    containersDeleted: number;
    networksDeleted: number;
    volumesDeleted: number;
    buildCacheBytes: number;
  }> {
    const docker = this.dockerOf(hostId);
    const out = {
      imagesDeleted: 0,
      containersDeleted: 0,
      networksDeleted: 0,
      volumesDeleted: 0,
      buildCacheBytes: 0,
    };
    if (opts.danglingImages) {
      // no filters → dangling-only, matching the dialog's label
      const r = (await docker.pruneImages()) as { ImagesDeleted?: unknown[] } | undefined;
      out.imagesDeleted = r?.ImagesDeleted?.length ?? 0;
    }
    if (opts.stoppedContainers) {
      const r = (await docker.pruneContainers()) as { ContainersDeleted?: unknown[] } | undefined;
      out.containersDeleted = r?.ContainersDeleted?.length ?? 0;
    }
    if (opts.unusedNetworks) {
      const r = (await docker.pruneNetworks()) as { NetworksDeleted?: unknown[] } | undefined;
      out.networksDeleted = r?.NetworksDeleted?.length ?? 0;
    }
    if (opts.unusedVolumes) {
      const r = (await docker.pruneVolumes()) as { VolumesDeleted?: unknown[] } | undefined;
      out.volumesDeleted = r?.VolumesDeleted?.length ?? 0;
    }
    if (opts.buildCache) {
      const r = (await docker.pruneBuilder()) as { SpaceReclaimed?: number } | undefined;
      out.buildCacheBytes = r?.SpaceReclaimed ?? 0;
    }
    return out;
  }

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

    const running = containers.filter((c) => c.State === 'running');
    // Sample in parallel — serial stats() calls made the dashboard feel stuck.
    const samples = await Promise.all(
      running.map((c) =>
        new Promise<Docker.ContainerStats | null>((resolve) => {
          const t = setTimeout(() => resolve(null), 1500);
          docker
            .getContainer(c.Id)
            .stats({ stream: false }, (err, s) => {
              clearTimeout(t);
              resolve(err ? null : (s as Docker.ContainerStats));
            });
        })
      )
    );

    for (const stats of samples) {
      if (!stats) continue;
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
    }

    // per-container samples use the docker formula (100% = one core), so the
    // aggregate is normalized by host core count: the dashboard renders this
    // as a share of total host capacity (matching memPercent = usage/limit)
    const cpuCount = info.NCPU || 1;
    return {
      cpuPercent: Math.min(cpuPercent / cpuCount, 100),
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
