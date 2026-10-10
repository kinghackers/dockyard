import * as esbuild from 'esbuild';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

async function build() {
  await esbuild.build({
    entryPoints: [
      path.join(root, 'electron/main.ts'),
      path.join(root, 'electron/preload.ts'),
    ],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    outdir: path.join(root, 'dist-electron'),
    external: ['electron', 'dockerode', 'ssh2'],
    sourcemap: true,
    logLevel: 'info',
  });
}

async function main() {
  // initial build
  await build();
  // watch
  const ctx = await esbuild.context({
    entryPoints: [
      path.join(root, 'electron/main.ts'),
      path.join(root, 'electron/preload.ts'),
    ],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    outdir: path.join(root, 'dist-electron'),
    external: ['electron', 'dockerode', 'ssh2'],
    sourcemap: true,
    logLevel: 'silent',
  });
  await ctx.watch();

  // launch electron once vite is actually accepting connections
  const electronBin = path.join(
    root,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'electron.cmd' : 'electron'
  );

  const waitForVite = async (timeoutMs = 20000) => {
    const url = 'http://127.0.0.1:5173';
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(url, { method: 'GET' });
        if (res.ok) return true;
      } catch {
        /* not up yet */
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    return false;
  };

  let started = false;
  const tryStart = () => {
    if (started) return;
    started = true;
  // Drop any Electron-degrading env vars so the app launches in normal GUI mode.
  // ELECTRON_RUN_AS_NODE=1 makes Electron behave like plain Node, which breaks
  // `require('electron')` (app/BrowserWindow become undefined) and prevents the
  // window from ever opening.
  const childEnv = { ...process.env, NODE_ENV: 'development' };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  const child = spawn(electronBin, ['--no-sandbox', '--disable-gpu', path.join(root, 'dist-electron/main.js')], {
    cwd: root,
    stdio: 'inherit',
    env: childEnv,
    shell: process.platform === 'win32',
  });
    child.on('exit', (code) => {
      process.exit(code ?? 0);
    });
  };

  const up = await waitForVite();
  if (!up) {
    console.error(
      '[dev-electron] Vite 在 http://127.0.0.1:5173 未就绪（端口被占？）。仍尝试启动 Electron…'
    );
  }
  tryStart();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
