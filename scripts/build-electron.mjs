import * as esbuild from 'esbuild';
import * as path from 'path';
import { fileURLToPath } from 'url';

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
    outExtension: { '.js': '.js' },
  });
  console.log('electron build done');
}

build().catch((e) => {
  console.error(e);
  process.exit(1);
});
