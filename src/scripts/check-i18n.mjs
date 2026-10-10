/**
 * i18n gate for the renderer (src/src):
 *   1. bare Chinese — user-visible strings that are NOT wrapped in t()
 *   2. missing keys — t('…') literals with no English entry in i18n/en.ts
 *   3. dead keys   — en.ts entries whose key no longer appears in any t() call
 *
 * Key = the zh-CN source string itself (see src/src/i18n/index.ts), so a
 * missing en entry silently degrades EN users to Chinese — this gate keeps
 * that from regressing. Exit code 1 on any violation.
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', 'src');
const EN_PATH = path.resolve(ROOT, 'i18n', 'en.ts');

// dictionary sources, test fixtures and ambient decls are intentionally exempt
const SKIP_DIRS = new Set(['node_modules', 'dist', 'tests', 'i18n', 'styles']);

/**
 * Lines whose raw source contains the token `i18n:allow-zh` are exempt from
 * the bare-Chinese check (JS: a line comment; JSX: a brace-wrapped comment).
 * Use only for intentionally-multilingual UI (locale names) and zh strings
 * routed through dynamic t() indirection (e.g. unitOf('分钟')).
 */
const ALLOW = /i18n:allow-zh/;

/** en.ts keys that are referenced dynamically (never as t() literals) */
const DYNAMIC_KEYS = new Set([
  // eventLabels() maps docker events to t('启动')-style literals — all covered
]);

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(p);
    } else if (/\.(ts|tsx)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) {
      files.push(p);
    }
  }
})(ROOT);

const blockComment = /\/\*[\s\S]*?\*\//g;
const lineComment = /\/\/.*$/gm;
// first arg of t('…') / t("…") / t(`…`). Negative lookbehind so the trailing
// "t(" inside identifiers like toast( / split( is NOT mistaken for a call
// (that caused false negatives, e.g. toast('已重命名') was silently skipped).
const tKey =
  /(?<![\w$])t\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g;
const CJK = /[一-鿿]/;

const usedKeys = new Set();
const bare = [];
const quotedZh = /(['"])((?:\\.|(?!\1).)*[一-鿿](?:\\.|(?!\1).)*)\1/g;

for (const f of files) {
  const rawLines = fs.readFileSync(f, 'utf8').split('\n');
  const allowedLines = new Set();
  rawLines.forEach((l, i) => {
    if (ALLOW.test(l)) {
      // the directive line itself and the line right below (JSX comments sit
      // above the text they annotate)
      allowedLines.add(i + 1);
      allowedLines.add(i + 2);
    }
  });
  // on allowed lines, quoted zh strings count as used keys when they exist in
  // en.ts (dynamic t() indirection like unitOf('分钟'))
  for (const n of allowedLines) {
    for (const m of (rawLines[n - 1]?.matchAll(quotedZh) ?? [])) {
      usedKeys.add(unescapeJs(m[2]));
    }
  }
  // blank comments WITHOUT collapsing newlines so line numbers stay stable
  const s = rawLines
    .join('\n')
    .replace(blockComment, (m) => m.replace(/[^\n]/g, ''))
    .replace(lineComment, '');
  // record the literal keys before blanking them out
  const keySrc = s;
  for (const m of keySrc.matchAll(tKey)) {
    const key = unescapeJs(m[2]);
    if (!key.includes('${')) usedKeys.add(key);
  }
  s.replace(tKey, 't(')
    .split('\n')
    .forEach((line, i) => {
      if (allowedLines.has(i + 1)) return;
      if (CJK.test(line)) {
        bare.push(`${rel(f)}:${i + 1}: ${line.trim()}`);
      }
    });
}

function rel(f) {
  return path.relative(path.resolve(__dirname, '..'), f).replace(/\\/g, '/');
}
function unescapeJs(s) {
  return s.replace(/\\(['"`\\nrt])/g, (_, c) =>
    ({ n: '\n', r: '\r', t: '\t' }[c] ?? c)
  );
}

// ---- parse en.ts keys ('key': value, one per line) ----
const enKeys = new Set();
const enSrc = fs.readFileSync(EN_PATH, 'utf8');
for (const m of enSrc.matchAll(/^\s*(['"])((?:\\.|(?!\1).)*)\1\s*:/gm)) {
  enKeys.add(unescapeJs(m[2]));
}

const missing = [...usedKeys].filter((k) => !enKeys.has(k)).sort();
const dead = [...enKeys]
  .filter((k) => !usedKeys.has(k) && !DYNAMIC_KEYS.has(k))
  .sort((a, b) => a.localeCompare(b, 'zh'));

let fail = false;
if (bare.length) {
  fail = true;
  console.error(`[check-i18n] ${bare.length} line(s) with Chinese outside t():`);
  for (const l of bare) console.error('  ' + l);
}
if (missing.length) {
  fail = true;
  console.error(`[check-i18n] ${missing.length} t() key(s) missing from i18n/en.ts:`);
  for (const k of missing) console.error(`  ${JSON.stringify(k)}`);
}
if (dead.length) {
  fail = true;
  console.error(`[check-i18n] ${dead.length} en.ts key(s) no longer used (delete or add to DYNAMIC_KEYS):`);
  for (const k of dead) console.error(`  ${JSON.stringify(k)}`);
}
if (fail) process.exit(1);
console.log(
  `i18n OK — ${files.length} files, ${usedKeys.size} t() keys, ${enKeys.size} en entries, all covered`
);
