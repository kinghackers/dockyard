/**
 * Lightweight consistency checks (no test framework):
 *  1. every ipcRenderer.invoke('docker:...') channel has a matching ipcMain.handle
 *  2. every window.dockerApi method declared in types/docker.ts is implemented in preload.ts
 *  3. every dockerApi method used in src/ is declared in types/docker.ts
 *
 * Run: node scripts/check-ipc.mjs
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'dist-electron') continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx|mjs)$/.test(name)) acc.push(p);
  }
  return acc;
}

const files = walk(join(root, 'src')).concat(walk(join(root, 'electron')));

let errors = 0;
const fail = (msg) => {
  errors += 1;
  console.error(`  ✗ ${msg}`);
};
const ok = (msg) => console.log(`  ✓ ${msg}`);

// ---- collect ipcMain.handle channels ----
const handleRe = /ipcMain\.handle\(\s*['"`]([^'"`]+)['"`]/g;
const handles = new Set();
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  let m;
  while ((m = handleRe.exec(text))) handles.add(m[1]);
}

// ---- collect ipcRenderer.invoke channels ----
const invokeRe = /ipcRenderer\.invoke\(\s*['"`]([^'"`]+)['"`]/g;
const invokes = new Set();
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  let m;
  while ((m = invokeRe.exec(text))) invokes.add(m[1]);
}

console.log('\n[1] IPC channel parity (invoke → handle)');
if (handles.size === 0) fail('no ipcMain.handle found');
for (const ch of invokes) {
  if (!handles.has(ch)) fail(`invoke '${ch}' has no ipcMain.handle`);
}
for (const ch of handles) {
  if (!invokes.has(ch)) fail(`handle '${ch}' is never invoked from renderer`);
}
if (errors === 0) ok(`${invokes.size} channels matched`);

// ---- window.dockerApi methods in types ----
const typesText = readFileSync(join(root, 'src/types/docker.ts'), 'utf8');
const apiBlock = typesText.split('dockerApi:')[1] || '';
const declRe = /^\s{6}(\w+)\s*[(:]/gm;
const declared = new Set();
let m;
while ((m = declRe.exec(apiBlock))) declared.add(m[1]);

// ---- preload implementations ----
const preloadText = readFileSync(join(root, 'electron/preload.ts'), 'utf8');
const implRe = /^\s{2}(\w+):\s/gm;
const implemented = new Set();
while ((m = implRe.exec(preloadText))) implemented.add(m[1]);

console.log('\n[2] dockerApi surface (types vs preload)');
for (const name of declared) {
  if (!implemented.has(name)) fail(`types declare '${name}' but preload does not implement it`);
}
for (const name of implemented) {
  if (!declared.has(name)) fail(`preload implements '${name}' but types do not declare it`);
}
if (errors === 0 || declared.size > 0) ok(`${declared.size} methods declared, ${implemented.size} implemented`);

// ---- usages in renderer ----
console.log('\n[3] dockerApi usages are declared');
const useRe = /dockerApi\.(\w+)\s*\(/g;
const used = new Set();
for (const f of files.filter((f) => f.includes(`${join('src', 'src')}`) || f.includes('src\\src') || f.includes('src/src'))) {
  const text = readFileSync(f, 'utf8');
  let u;
  while ((u = useRe.exec(text))) used.add(u[1]);
}
for (const name of used) {
  if (!declared.has(name)) fail(`renderer calls dockerApi.${name}() which is not in types`);
}
ok(`${used.size} methods used in renderer`);

console.log(errors === 0 ? '\nAll IPC consistency checks passed.' : `\n${errors} problem(s) found.`);
process.exit(errors === 0 ? 0 : 1);
