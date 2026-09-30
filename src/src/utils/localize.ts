/**
 * Chinese localization helpers for Docker API strings and UI chrome.
 * Docker returns English status text (e.g. "Up 5 minutes", "Exited (0) 1 hour ago").
 */

/** Translate container Status strings from Docker Engine. */
export function localizeContainerStatus(status: string): string {
  if (!status) return status;

  // Paused / Created / Dead / Removal In Progress / Restarting
  if (status === 'Created') return '已创建';
  if (status === 'Paused') return '已暂停';
  if (status === 'Dead') return '无响应';
  if (status === 'Removal In Progress') return '正在移除';

  // Exited (code) X ago
  let m = status.match(/^Exited\s*\((\d+)\)\s+(.*)$/i);
  if (m) return `已退出 (${m[1]}) ${localizeDurationAgo(m[2])}`;

  // Restarting (n) X ago
  m = status.match(/^Restarting\s*\((\d+)\)\s+(.*)$/i);
  if (m) return `重启中 (${m[1]}) ${localizeDurationAgo(m[2])}`;

  // Up X (healthy|unhealthy|health: starting)
  m = status.match(/^Up\s+(.*?)\s*\((healthy|unhealthy|health:\s*starting)\)$/i);
  if (m) {
    const health =
      m[2].toLowerCase() === 'healthy'
        ? '健康'
        : m[2].toLowerCase() === 'unhealthy'
          ? '不健康'
          : '健康检查中';
    return `运行中 ${localizeDuration(m[1])}（${health}）`;
  }

  // Up X
  m = status.match(/^Up\s+(.*)$/i);
  if (m) return `运行中 ${localizeDuration(m[1])}`;

  return status;
}

/** Translate short state names used in chips. */
export function localizeContainerState(state: string): string {
  switch (state) {
    case '':
    case 'unknown':
      return '未知';
    case 'created':
      return '已创建';
    case 'running':
      return '运行中';
    case 'paused':
      return '已暂停';
    case 'restarting':
      return '重启中';
    case 'removing':
      return '移除中';
    case 'exited':
      return '已退出';
    case 'dead':
      return '无响应';
    default:
      return state;
  }
}

/** Translate Docker restart policy names. */
export function localizeRestartPolicy(policy: string | undefined): string {
  switch (policy) {
    case 'no':
      return '不自动重启';
    case 'always':
      return '总是重启';
    case 'on-failure':
      return '失败时重启';
    case 'unless-stopped':
      return '除非手动停止否则重启';
    default:
      return policy || '-';
  }
}

/** Translate network / volume scope values. */
export function localizeScope(scope: string): string {
  switch (scope) {
    case 'local':
      return '本地';
    case 'global':
      return '全局';
    case 'swarm':
      return 'Swarm';
    default:
      return scope;
  }
}

/** Translate network driver names for display. */
export function localizeNetworkDriver(driver: string): string {
  switch (driver) {
    case 'bridge':
      return '桥接';
    case 'host':
      return '主机';
    case 'none':
      return '无';
    case 'overlay':
      return '覆盖';
    case 'macvlan':
      return 'macvlan';
    case 'ipvlan':
      return 'ipvlan';
    default:
      return driver;
  }
}

/** Translate volume driver names for display. */
export function localizeVolumeDriver(driver: string): string {
  switch (driver) {
    case 'local':
      return '本地';
    case 'nfs':
      return 'NFS';
    default:
      return driver;
  }
}

/** "5 minutes" / "About an hour" / "an hour" → "5 分钟" / "约 1 小时" / "1 小时" */
function localizeDuration(s: string): string {
  if (!s) return '';
  let t = s.trim();

  if (/^about\s+/i.test(t)) {
    t = t.replace(/^about\s+/i, '');
    return `约 ${localizeDuration(t)}`;
  }
  if (/^less than a minute$/i.test(t) || /^a few seconds$/i.test(t)) return '不到 1 分钟';
  if (/^a minute$/i.test(t)) return '1 分钟';
  if (/^an hour$/i.test(t)) return '1 小时';
  if (/^a day$/i.test(t)) return '1 天';
  if (/^a week$/i.test(t)) return '1 周';
  if (/^a month$/i.test(t)) return '1 个月';
  if (/^a year$/i.test(t)) return '1 年';

  t = t
    .replace(/\bseconds?\b/gi, '秒')
    .replace(/\bminutes?\b/gi, '分钟')
    .replace(/\bhours?\b/gi, '小时')
    .replace(/\bdays?\b/gi, '天')
    .replace(/\bweeks?\b/gi, '周')
    .replace(/\bmonths?\b/gi, '个月')
    .replace(/\byears?\b/gi, '年');
  return t;
}

/** "2 hours ago" → "2 小时前" */
function localizeDurationAgo(s: string): string {
  if (!s) return '';
  const t = s.trim().replace(/\s+ago$/i, '');
  return `${localizeDuration(t)}前`;
}

/** Short status chip label for list rows. */
export function localizeStatusChip(status: string, state: string): string {
  // Prefer a short Chinese label; fall back to localized full status.
  switch (state) {
    case 'running':
      return '运行中';
    case 'exited':
      return '已退出';
    case 'paused':
      return '已暂停';
    case 'created':
      return '已创建';
    case 'restarting':
      return '重启中';
    case 'removing':
      return '移除中';
    case 'dead':
      return '无响应';
    default:
      return localizeContainerStatus(status) || state;
  }
}
