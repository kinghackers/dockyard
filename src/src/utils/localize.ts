import { t } from '../i18n';

/**
 * Chinese localization helpers for Docker API strings and UI chrome.
 * Docker returns English status text (e.g. "Up 5 minutes", "Exited (0) 1 hour ago").
 */

/** Translate container Status strings from Docker Engine. */
export function localizeContainerStatus(status: string): string {
  if (!status) return status;

  // Paused / Created / Dead / Removal In Progress / Restarting
  if (status === 'Created') return t('已创建');
  if (status === 'Paused') return t('已暂停');
  if (status === 'Dead') return t('无响应');
  if (status === 'Removal In Progress') return t('正在移除');

  // Exited (code) X ago
  let m = status.match(/^Exited\s*\((\d+)\)\s+(.*)$/i);
  if (m) return t("已退出 ({p0}) {p1}", { p0: m[1], p1: localizeDurationAgo(m[2]) });

  // Restarting (n) X ago
  m = status.match(/^Restarting\s*\((\d+)\)\s+(.*)$/i);
  if (m) return t("重启中 ({p0}) {p1}", { p0: m[1], p1: localizeDurationAgo(m[2]) });

  // Up X (healthy|unhealthy|health: starting)
  m = status.match(/^Up\s+(.*?)\s*\((healthy|unhealthy|health:\s*starting)\)$/i);
  if (m) {
    const health =
      m[2].toLowerCase() === 'healthy'
        ? t('健康')
        : m[2].toLowerCase() === 'unhealthy'
          ? t('不健康')
          : t('健康检查中');
    return t("运行中 {p0}（{p1}）", { p0: localizeDuration(m[1]), p1: health });
  }

  // Up X
  m = status.match(/^Up\s+(.*)$/i);
  if (m) return t("运行中 {p0}", { p0: localizeDuration(m[1]) });

  return status;
}

/** Translate short state names used in chips. */
export function localizeContainerState(state: string): string {
  switch (state) {
    case '':
    case 'unknown':
      return t('未知');
    case 'created':
      return t('已创建');
    case 'running':
      return t('运行中');
    case 'paused':
      return t('已暂停');
    case 'restarting':
      return t('重启中');
    case 'removing':
      return t('移除中');
    case 'exited':
      return t('已退出');
    case 'dead':
      return t('无响应');
    default:
      return state;
  }
}

/** Translate Docker restart policy names. */
export function localizeRestartPolicy(policy: string | undefined): string {
  switch (policy) {
    case 'no':
      return t('不自动重启');
    case 'always':
      return t('总是重启');
    case 'on-failure':
      return t('失败时重启');
    case 'unless-stopped':
      return t('除非手动停止否则重启');
    default:
      return policy || '-';
  }
}

/** Translate network / volume scope values. */
export function localizeScope(scope: string): string {
  switch (scope) {
    case 'local':
      return t('本地');
    case 'global':
      return t('全局');
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
      return t('桥接');
    case 'host':
      return t('主机');
    case 'none':
      return t('无');
    case 'overlay':
      return t('覆盖');
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
      return t('本地');
    case 'nfs':
      return 'NFS';
    default:
      return driver;
  }
}

/** "5 minutes" / "About an hour" / "an hour" → "5 分钟" / "约 1 小时" / "1 小时" */
function localizeDuration(s: string): string {
  if (!s) return '';
  let rest = s.trim();

  if (/^about\s+/i.test(rest)) {
    rest = rest.replace(/^about\s+/i, '');
    return t('约 {p0}', { p0: localizeDuration(rest) });
  }
  if (/^less than a minute$/i.test(rest) || /^a few seconds$/i.test(rest)) return t('不到 1 分钟');
  if (/^a minute$/i.test(rest)) return t('1 分钟');
  if (/^an hour$/i.test(rest)) return t('1 小时');
  if (/^a day$/i.test(rest)) return t('1 天');
  if (/^a week$/i.test(rest)) return t('1 周');
  if (/^a month$/i.test(rest)) return t('1 个月');
  if (/^a year$/i.test(rest)) return t('1 年');

  return rest
    .replace(/\bseconds?\b/gi, t('秒'))
    .replace(/\bminutes?\b/gi, t('分钟'))
    .replace(/\bhours?\b/gi, t('小时'))
    .replace(/\bdays?\b/gi, t('天'))
    .replace(/\bweeks?\b/gi, t('周'))
    .replace(/\bmonths?\b/gi, t('个月'))
    .replace(/\byears?\b/gi, t('年'));
}

/** "2 hours ago" → "2 小时前" */
function localizeDurationAgo(s: string): string {
  if (!s) return '';
  const rest = s.trim().replace(/\s+ago$/i, '');
  return t('{p0}前', { p0: localizeDuration(rest) });
}

/** Short status chip label for list rows. */
export function localizeStatusChip(status: string, state: string): string {
  // Prefer a short Chinese label; fall back to localized full status.
  switch (state) {
    case 'running':
      if (/\(unhealthy\)/i.test(status)) return t('不健康');
      if (/\(health:\s*starting\)/i.test(status)) return t('健康检查中');
      if (/\(healthy\)/i.test(status)) return t('运行中 · 健康');
      return t('运行中');
    case 'exited':
      return t('已退出');
    case 'paused':
      return t('已暂停');
    case 'created':
      return t('已创建');
    case 'restarting':
      return t('重启中');
    case 'removing':
      return t('移除中');
    case 'dead':
      return t('无响应');
    default:
      return localizeContainerStatus(status) || state;
  }
}

/**
 * Extra CSS class when a running container fails its healthcheck,
 * so lists can paint the chip as an error.
 */
export function statusChipExtraClass(status: string, state: string): string {
  if (state === 'running' && /\(unhealthy\)/i.test(status)) return 'unhealthy';
  return '';
}
