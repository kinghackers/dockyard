/** Injected at build/dev time via Vite `define`. */
export const APP_VERSION: string =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0-dev';

export const BUILD_TIME: string =
  typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : '';

/** "0.1.0 · 2026-09-30 16:40" or just the version when no build stamp. */
export function formatBuildLabel(): string {
  if (!BUILD_TIME) return `v${APP_VERSION}`;
  const d = new Date(BUILD_TIME);
  if (Number.isNaN(d.getTime())) return `v${APP_VERSION}`;
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `v${APP_VERSION} · ${stamp}`;
}
