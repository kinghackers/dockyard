import { t } from '../i18n';

/** Human-readable byte size — single source shared by all pages. */
export function fmtBytes(n: number | undefined, emptyLabel = '0 B'): string {
  if (!n || n < 0) return emptyLabel;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

/* ------------------------------------------------------------------ *
 * Time rendering
 *
 * Lists show a coarse, scannable "3 days ago" and expose the exact
 * timestamp on hover (title), the way Docker Desktop / Portainer do —
 * an absolute `toLocaleString()` on every row is noisy and unreadable
 * at a glance.
 * ------------------------------------------------------------------ */

/** Epoch milliseconds from a ms number or an ISO string; NaN if unparseable. */
function toMs(value: number | string | null | undefined): number {
  if (value === undefined || value === null || value === '') return NaN;
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? NaN : ms;
}

/**
 * Unit label without the surrounding spaces. The shared unit keys carry a
 * leading space because they are spliced into Docker's English status text
 * ("Up 5 minutes" → "5" + " minutes"); here the string is assembled by hand,
 * so the space is supplied exactly once.
 */
function unitOf(key: string): string {
  return t(key).trim();
}

/** "3 天前" / "3 days ago". Accepts epoch ms or an ISO string; "-" if invalid. */
export function fmtTimeAgo(value: number | string | null | undefined): string {
  const ms = toMs(value);
  if (Number.isNaN(ms)) return '-';

  const sec = Math.floor((Date.now() - ms) / 1000);
  if (sec < 60) return t('刚刚');

  const min = Math.floor(sec / 60);
  if (min < 60) return t('{p0}前', { p0: `${min} ${unitOf('分钟')}` });

  const hour = Math.floor(min / 60);
  if (hour < 24) return t('{p0}前', { p0: `${hour} ${unitOf('小时')}` });

  const day = Math.floor(hour / 24);
  if (day < 30) return t('{p0}前', { p0: `${day} ${unitOf('天')}` });

  const month = Math.floor(day / 30);
  if (month < 12) return t('{p0}前', { p0: `${month} ${unitOf('个月')}` });

  return t('{p0}前', { p0: `${Math.floor(day / 365)} ${unitOf('年')}` });
}

/** Exact local timestamp for the hover `title`; "-" if unparseable. */
export function fmtAbsolute(value: number | string | null | undefined): string {
  const ms = toMs(value);
  return Number.isNaN(ms) ? '-' : new Date(ms).toLocaleString();
}
