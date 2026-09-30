/**
 * Pure-logic unit checks (no test framework):
 *   containerActions / ports / localize
 *
 * Run: node scripts/check-logic.mjs
 * Bundles the TS utils with esbuild, then asserts with node:assert.
 */
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = mkdtempSync(join(tmpdir(), 'dockyard-logic-'));

let failed = 0;
const ok = (name) => console.log(`  ✓ ${name}`);
const fail = (name, err) => {
  failed += 1;
  console.error(`  ✗ ${name}`);
  console.error(`    ${err && err.message ? err.message : err}`);
};

function test(name, fn) {
  try {
    fn();
    ok(name);
  } catch (err) {
    fail(name, err);
  }
}

try {
  await build({
    entryPoints: [
      join(root, 'src/utils/containerActions.ts'),
      join(root, 'src/utils/ports.ts'),
      join(root, 'src/utils/localize.ts'),
    ],
    bundle: true,
    format: 'esm',
    outdir: outDir,
    outExtension: { '.js': '.mjs' },
    platform: 'neutral',
    logLevel: 'silent',
  });

  const actions = await import(pathToFileURL(join(outDir, 'containerActions.mjs')).href);
  const ports = await import(pathToFileURL(join(outDir, 'ports.mjs')).href);
  const localize = await import(pathToFileURL(join(outDir, 'localize.mjs')).href);

  console.log('\n[1] containerActions');
  const { getContainerActions } = actions;

  test('running allows stop/restart/pause/exec, not start', () => {
    const a = getContainerActions('running', 'Up 2 minutes');
    assert.equal(a.canStop, true);
    assert.equal(a.canRestart, true);
    assert.equal(a.canPause, true);
    assert.equal(a.canExec, true);
    assert.equal(a.canStart, false);
    assert.equal(a.canUnpause, false);
  });

  test('exited allows start/remove/logs, not exec/stop', () => {
    const a = getContainerActions('exited', 'Exited (1) 3 seconds ago');
    assert.equal(a.canStart, true);
    assert.equal(a.canRemove, true);
    assert.equal(a.canLogs, true);
    assert.equal(a.canExec, false);
    assert.equal(a.canStop, false);
    assert.equal(a.canKill, false);
  });

  test('paused allows unpause/stop, not pause/exec', () => {
    const a = getContainerActions('paused', 'Paused');
    assert.equal(a.canUnpause, true);
    assert.equal(a.canStop, true);
    assert.equal(a.canPause, false);
    assert.equal(a.canExec, false);
  });

  test('restarting allows stop/kill, not start/restart/exec', () => {
    const a = getContainerActions('restarting', 'Restarting (1) Less than a second ago');
    assert.equal(a.canStop, true);
    assert.equal(a.canKill, true);
    assert.equal(a.canStart, false);
    assert.equal(a.canRestart, false);
    assert.equal(a.canExec, false);
    assert.equal(a.isRestartLoop, true);
  });

  test('removing is busy — no lifecycle actions', () => {
    const a = getContainerActions('removing');
    assert.equal(a.isBusy, true);
    assert.equal(a.canStart, false);
    assert.equal(a.canStop, false);
    assert.equal(a.canRemove, false);
    assert.equal(a.canLogs, false);
    assert.equal(a.canExec, false);
  });

  test('restartCount >= 3 flags restart loop even when running', () => {
    const a = getContainerActions('running', 'Up 1 second', 5);
    assert.equal(a.isRestartLoop, true);
    const b = getContainerActions('running', 'Up 1 second', 1);
    assert.equal(b.isRestartLoop, false);
  });

  console.log('\n[2] ports');
  const { formatPortMappings, formatPortMappingsDetailed } = ports;

  test('empty / missing ports render dash', () => {
    assert.equal(formatPortMappings(undefined), '-');
    assert.equal(formatPortMappings([]), '-');
    assert.equal(formatPortMappingsDetailed(undefined), '-');
  });

  test('unpublished (exposed-only) ports are hidden in list format', () => {
    assert.equal(
      formatPortMappings([{ privatePort: 6379, type: 'tcp' }]),
      '-'
    );
  });

  test('dual-stack IPv4/IPv6 same mapping collapses to one pair', () => {
    const text = formatPortMappings([
      { ip: '0.0.0.0', privatePort: 5432, publicPort: 54321, type: 'tcp' },
      { ip: '::', privatePort: 5432, publicPort: 54321, type: 'tcp' },
    ]);
    assert.equal(text, '54321→5432');
  });

  test('distinct mappings are kept and protocol suffix shown for non-tcp', () => {
    const text = formatPortMappings([
      { ip: '0.0.0.0', privatePort: 80, publicPort: 8080, type: 'tcp' },
      { ip: '0.0.0.0', privatePort: 443, publicPort: 8443, type: 'tcp' },
      { ip: '0.0.0.0', privatePort: 53, publicPort: 5353, type: 'udp' },
    ]);
    assert.equal(text, '8080→80, 8443→443, 5353→53/udp');
  });

  test('detailed format keeps IP rows but drops exact duplicates', () => {
    const text = formatPortMappingsDetailed([
      { ip: '0.0.0.0', privatePort: 5432, publicPort: 54321, type: 'tcp' },
      { ip: '0.0.0.0', privatePort: 5432, publicPort: 54321, type: 'tcp' },
      { ip: '::', privatePort: 5432, publicPort: 54321, type: 'tcp' },
    ]);
    assert.equal(text.split('\n').length, 2);
    assert.match(text, /0\.0\.0\.0:54321/);
    assert.match(text, /:::54321/);
  });

  console.log('\n[3] localize');
  test('restart policy labels', () => {
    assert.equal(localize.localizeRestartPolicy('no'), '不自动重启');
    assert.equal(localize.localizeRestartPolicy('always'), '总是重启');
    assert.equal(localize.localizeRestartPolicy('on-failure'), '失败时重启');
    assert.equal(localize.localizeRestartPolicy('unless-stopped'), '除非手动停止否则重启');
  });

  test('container status strings localize', () => {
    assert.equal(localize.localizeContainerStatus('Created'), '已创建');
    assert.equal(localize.localizeContainerStatus('Paused'), '已暂停');
    assert.match(localize.localizeContainerStatus('Exited (1) 2 minutes ago'), /^已退出 \(1\)/);
    assert.match(localize.localizeContainerStatus('Up 5 seconds'), /^运行中/);
  });

  test('status chip prefers short state labels', () => {
    assert.equal(localize.localizeStatusChip('Up 2 hours', 'running'), '运行中');
    assert.equal(localize.localizeStatusChip('Exited (0) 1 hour ago', 'exited'), '已退出');
    assert.equal(localize.localizeStatusChip('Restarting (1) 2 seconds ago', 'restarting'), '重启中');
    assert.equal(localize.localizeStatusChip('Up 30 seconds (unhealthy)', 'running'), '不健康');
    assert.equal(localize.localizeStatusChip('Up 5 seconds (health: starting)', 'running'), '健康检查中');
  });
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

console.log('');
if (failed > 0) {
  console.error(`${failed} check(s) failed`);
  process.exit(1);
}
console.log('All logic checks passed');
