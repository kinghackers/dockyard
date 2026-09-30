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

  // launch electron once vite is up (retry briefly)
  const electronBin = path.join(
    root,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'electron.cmd' : 'electron'
  );

  let started = false;
  const tryStart = () => {
    if (started) return;
    started = true;
    const child = spawn(electronBin, [path.join(root, 'dist-electron/main.js')], {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'development' },
      shell: process.platform === 'win32',
    });
    child.on('exit', (code) => {
      process.exit(code ?? 0);
    });
  };

  // wait a bit for vite
  setTimeout(tryStart, 1500);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
