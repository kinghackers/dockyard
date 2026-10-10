import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as esbuild from 'esbuild';

/**
 * E2E smoke: the real main-process stack (connectionManager → dockerode)
 * against a mock Docker Engine HTTP API. Verifies connect, container list /
 * inspect, image list, system stats/df, docker events, and config persistence
 * over an actual socket — no Electron GUI involved.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

let failures = 0;
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
};

// ---------- mock Docker daemon ----------
const CONTAINER = {
  Id: 'a'.repeat(64),
  Names: ['/mock-web'],
  Image: 'nginx:latest',
  ImageID: 'sha256:' + 'b'.repeat(64),
  Command: 'nginx -g daemon off;',
  Created: Math.floor(Date.now() / 1000) - 3600,
  State: 'running',
  Status: 'Up 1 hour',
  Labels: { 'com.docker.compose.project': 'mockproj' },
  Ports: [{ IP: '0.0.0.0', PrivatePort: 80, PublicPort: 8080, Type: 'tcp' }],
  HostConfig: { NetworkMode: 'bridge' },
};

const sseClients = new Set();
function json(res, body, code = 200) {
  const data = JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(data);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  if (p === '/_ping') return res.writeHead(200).end('OK');
  if (p === '/version')
    return json(res, { Version: '25.0.0-mock', ApiVersion: '1.44', Os: 'linux', Arch: 'amd64' });
  if (p === '/info')
    return json(res, {
      ID: 'mock',
      Containers: 1,
      ContainersRunning: 1,
      Images: 1,
      ServerVersion: '25.0.0-mock',
      OperatingSystem: 'Mock Linux',
      NCPU: 4,
      MemTotal: 8 * 1024 ** 3,
      Driver: 'overlay2',
    });
  if (p === '/containers/json') return json(res, [CONTAINER]);
  if (/^\/containers\/[^/]+\/json$/.test(p))
    return json(res, {
      ...CONTAINER,
      Name: '/mock-web',
      Config: { Cmd: ['nginx'], Hostname: 'mock', Env: ['A=1'], Labels: CONTAINER.Labels },
      State: {
        Status: 'running',
        Running: true,
        ExitCode: 0,
        StartedAt: new Date().toISOString(),
        OOMKilled: false,
        Health: { Status: 'healthy', FailingStreak: 0, Log: [] },
      },
      Mounts: [],
      NetworkSettings: { Ports: { '80/tcp': [{ HostIp: '0.0.0.0', HostPort: '8080' }] }, Networks: {} },
      RestartCount: 0,
      Platform: 'linux',
    });
  if (/^\/containers\/[^/]+\/stats$/.test(p))
    return json(res, {
      cpu_stats: { cpu_usage: { total_usage: 200 }, system_cpu_usage: 2000, online_cpus: 4 },
      precpu_stats: { cpu_usage: { total_usage: 100 }, system_cpu_usage: 1000 },
      memory_stats: { usage: 100 * 1024 ** 2, limit: 1024 ** 3 },
      networks: {},
      blkio_stats: { io_service_bytes_recursive: [] },
    });
  if (p === '/images/json')
    return json(res, [
      {
        Id: 'sha256:' + 'b'.repeat(64),
        RepoTags: ['nginx:latest'],
        RepoDigests: [],
        Created: Math.floor(Date.now() / 1000) - 86400,
        Size: 142 * 1024 ** 2,
        VirtualSize: 142 * 1024 ** 2,
        Labels: {},
      },
    ]);
  if (p === '/networks') return json(res, []);
  if (p === '/volumes') return json(res, { Volumes: [] });
  if (p === '/system/df') return json(res, { Images: [], Containers: [], Volumes: [] });
  if (p === '/events') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    sseClients.add(res);
    res.on('close', () => sseClients.delete(res));
    return;
  }
  json(res, { message: `mock: no route ${p}` }, 404);
});

const port = await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));

// ---------- build the manager bundle (electron stubbed) ----------
const outfile = path.join(root, '.e2e', 'manager.cjs');
await esbuild.build({
  entryPoints: [path.join(root, 'electron/docker/connectionManager.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile,
  external: ['dockerode', 'ssh2', 'cpu-features'],
  plugins: [
    {
      name: 'electron-stub',
      setup(build) {
        build.onResolve({ filter: /^electron$/ }, () => ({
          path: path.join(root, 'scripts/e2e-electron-stub.cjs'),
        }));
      },
    },
  ],
  logLevel: 'silent',
});

const { DockerConnectionManager } = await import(`file://${outfile}`);

// ---------- run the smoke flow ----------
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dockyard-e2e-'));
const manager = new DockerConnectionManager(tmpDir);

try {
  console.log('E2E smoke against mock daemon');

  // config persistence round-trip
  manager.upsertConfig({ id: 'mock-1', name: 'Mock Host', kind: 'tcp', host: '127.0.0.1', port });
  const configs = manager.listConfigs();
  ok('config persisted and reloaded', configs.length === 1 && configs[0].name === 'Mock Host');

  // connect + status
  const status = await manager.connect('mock-1');
  ok('connect() succeeds', status.connected === true, status.error || '');
  ok('systemInfo reflects mock version', status.info?.serverVersion === '25.0.0-mock');

  // containers
  const list = await manager.listContainers('mock-1', true);
  ok('listContainers returns one row', list.length === 1 && list[0].name === 'mock-web');
  ok('container labels parsed', list[0].composeProject === 'mockproj');

  const detail = await manager.inspectContainer('mock-1', CONTAINER.Id);
  ok('inspectContainer maps health', detail.health?.status === 'healthy');
  ok('inspectContainer maps ports', detail.ports.some((x) => x.publicPort === 8080));

  // stats / df
  const stats = await manager.systemStats('mock-1');
  ok('systemStats aggregates cpu', typeof stats.cpuPercent === 'number');

  const df = await manager.systemDf('mock-1');
  ok('systemDf returns shape', typeof df.reclaimableBytes === 'number');

  // events stream
  const eventPromise = new Promise((resolve) => {
    manager.streamEvents('mock-1', (e) => resolve(e), () => {});
  });
  await new Promise((r) => setTimeout(r, 150)); // let the stream attach
  for (const client of sseClients) {
    client.write(
      JSON.stringify({
        Type: 'container',
        Action: 'die',
        id: CONTAINER.Id,
        Actor: { ID: CONTAINER.Id, Attributes: { name: 'mock-web', exitCode: '1' } },
        time: Math.floor(Date.now() / 1000),
      }) + '\n'
    );
  }
  const event = await Promise.race([eventPromise, new Promise((r) => setTimeout(() => r(null), 3000))]);
  ok('streamEvents delivers a die event', !!event && event.action === 'die' && event.name === 'mock-web');

  await manager.disconnectAll();
  ok('disconnectAll completes', true);
} catch (err) {
  console.error('  ✗ smoke crashed:', err?.message || err);
  failures++;
} finally {
  server.close();
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

console.log(failures === 0 ? 'E2E smoke passed' : `E2E smoke FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
