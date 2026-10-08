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
