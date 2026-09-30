/**
 * Post-build smoke checks (no Electron launch required).
 * Verifies the packaged sources look shippable: entrypoints exist,
 * branding/menu/icon wiring is present, and renderer bundle is non-trivial.
 *
 * Run after `npm run build`:
 *   node scripts/check-dist.mjs
 */
import { readFileSync, existsSync, statSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let failed = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const fail = (msg) => {
  failed += 1;
  console.error(`  ✗ ${msg}`);
};

function mustExist(rel, minBytes = 1) {
  const p = join(root, rel);
  if (!existsSync(p)) {
    fail(`missing ${rel}`);
    return null;
  }
  const n = statSync(p).size;
  if (n < minBytes) {
    fail(`${rel} too small (${n} bytes)`);
    return null;
  }
  ok(`${rel} (${n} bytes)`);
  return readFileSync(p, 'utf8');
}

console.log('\n[1] build artifacts');
const indexHtml = mustExist('dist/index.html', 200);
const mainJs = mustExist('dist-electron/main.js', 500);
mustExist('dist-electron/preload.js', 200);
const assets = existsSync(join(root, 'dist/assets'));
ok(assets ? 'dist/assets present' : 'dist/assets missing');
if (!assets) fail('dist/assets missing');

console.log('\n[2] window chrome / branding');
if (mainJs) {
  if (mainJs.includes('titleBarOverlay') || mainJs.includes('titleBarStyle')) {
    ok('dark title-bar overlay wired');
  } else {
    fail('titleBarOverlay/titleBarStyle not found in main.js');
  }
  if (mainJs.includes('removeMenu') || mainJs.includes('setApplicationMenu(null)')) {
    ok('application menu removed');
  } else {
    fail('menu removal not found in main.js');
  }
  if (mainJs.includes('Docker')) {
    ok('product display name present');
  } else {
    fail('product display name missing');
  }
}

console.log('\n[3] renderer bundle');
if (indexHtml) {
  if (/src="\.\/assets\/.*\.js"|src="\/assets\/.*\.js"|src="\.\/.*\.js"/.test(indexHtml) || indexHtml.includes('assets/')) {
    ok('index.html references bundled assets');
  } else {
    fail('index.html has no script bundle reference');
  }
  if (indexHtml.includes('Docker')) {
    ok('html title branded');
  }
}

// renderer js: pick largest asset chunk
try {
  const assetsDir = join(root, 'dist/assets');
  const fs = await import('fs');
  const jsFiles = fs
    .readdirSync(assetsDir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => ({ f, n: statSync(join(assetsDir, f)).size }))
    .sort((a, b) => b.n - a.n);
  if (jsFiles.length === 0) fail('no js chunks under dist/assets');
  else {
    const biggest = jsFiles[0];
    ok(`renderer chunk ${biggest.f} (${biggest.n} bytes)`);
    if (biggest.n < 50_000) fail('renderer chunk unexpectedly small');
    const text = readFileSync(join(assetsDir, biggest.f), 'utf8');
    for (const needle of ['排障速览', '停止重启循环', 'composeLogs', '镜像历史']) {
      if (text.includes(needle)) ok(`bundle contains ${needle}`);
      else fail(`bundle missing ${needle}`);
    }
  }
} catch (e) {
  fail(`cannot scan dist/assets: ${e.message}`);
}

console.log('\n[4] icon');
const ico = join(root, 'build/icon.ico');
if (!existsSync(ico)) fail('build/icon.ico missing');
else ok(`build/icon.ico (${statSync(ico).size} bytes)`);
try {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (pkg.build?.win?.icon) ok(`package.json win.icon = ${pkg.build.win.icon}`);
  else fail('package.json build.win.icon not set');
  if (pkg.build?.productName === 'Docker 管理器') ok('productName matches UI brand');
  else fail(`unexpected productName: ${pkg.build?.productName}`);
} catch (e) {
  fail(`package.json unreadable: ${e.message}`);
}

console.log('');
if (failed > 0) {
  console.error(`${failed} smoke check(s) failed`);
  process.exit(1);
}
console.log('All dist smoke checks passed');
