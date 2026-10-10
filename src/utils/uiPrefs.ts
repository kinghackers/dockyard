/** Persist small UI prefs (list filter/sort) in localStorage. */
const PREFIX = 'dockyard:ui:';
// 旧包名 docker-manager 遗留前缀；首次读取时自动迁移到新前缀后删除旧键
const LEGACY_PREFIX = 'docker-manager:ui:';

export function loadUiPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw != null) return JSON.parse(raw) as T;
    // 兼容旧包名：回退读取旧前缀，迁移到新前缀并清理旧键，避免用户已保存的筛选/排序丢失
    const legacy = localStorage.getItem(LEGACY_PREFIX + key);
    if (legacy != null) {
      localStorage.setItem(PREFIX + key, legacy);
      localStorage.removeItem(LEGACY_PREFIX + key);
      return JSON.parse(legacy) as T;
    }
    return fallback;
  } catch {
    return fallback;
  }
}

export function saveUiPref(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* ignore quota / private mode */
  }
}
