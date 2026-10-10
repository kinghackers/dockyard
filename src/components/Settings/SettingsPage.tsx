import { useEffect, useState } from 'react';
import { Settings as SettingsIcon, Bell, Palette, Info, RefreshCw, ScrollText, List } from 'lucide-react';
import { loadUiPref, saveUiPref } from '../../utils/uiPrefs';
import { formatBuildLabel } from '../../utils/buildInfo';
import { useAppStore } from '../../stores/appStore';
import { applyTheme as applyThemePref, watchTheme, type ThemePref } from '../../utils/theme';
import { t, useT, useI18n, type LocalePref } from '../../i18n';

/**
 * App settings: theme, language, notifications, polling & data limits. Values
 * persist in localStorage and apply immediately (theme/locale) or on next
 * trigger (the rest).
 */
export function SettingsPage() {
  const t = useT();
  const setI18nPref = useI18n((s) => s.setPref);
  const [locale, setLocale] = useState<LocalePref>(loadUiPref<LocalePref>('settings.locale', 'auto'));
  const [theme, setTheme] = useState<ThemePref>(loadUiPref<ThemePref>('settings.theme', 'dark'));
  const [notifyExit, setNotifyExit] = useState(loadUiPref('settings.notifyAbnormalExit', true));
  const [pollIntervalMs, setPollIntervalMs] = useState(loadUiPref('settings.pollIntervalMs', 10000));
  const [logMaxLines, setLogMaxLines] = useState(loadUiPref('settings.logMaxLines', 8000));
  const [eventMaxCount, setEventMaxCount] = useState(loadUiPref('settings.eventMaxCount', 40));
  const [autoReconnect, setAutoReconnect] = useState(loadUiPref('settings.autoReconnect', true));
  const [minimizeToTray, setMinimizeToTray] = useState(loadUiPref('settings.minimizeToTray', false));
  const [autoLaunch, setAutoLaunch] = useState(loadUiPref('settings.autoLaunch', false));

  const applyTheme = (next: ThemePref) => {
    setTheme(next);
    saveUiPref('settings.theme', next);
    applyThemePref(next);
  };

  // follow OS scheme changes while the preference is 'auto'
  useEffect(() => watchTheme(theme), [theme]);

  const applyNotify = (next: boolean) => {
    setNotifyExit(next);
    saveUiPref('settings.notifyAbnormalExit', next);
  };

  const applyPref = <T,>(key: string, next: T, set: (v: T) => void) => {
    set(next);
    saveUiPref(key, next);
  };

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-title">
          <SettingsIcon size={18} color="var(--accent)" />
          {t('设置')}
        </div>
      </div>

      <div className="section-title">{t('外观')}</div>
      <div className="form-row" style={{ maxWidth: 320 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, textTransform: 'none' }}>
          <List size={14} />
          语言 / 語言 / Language{/* i18n:allow-zh — trilingual on purpose */}
        </label>
        <select
          value={locale}
          onChange={(e) => {
            const next = e.target.value as LocalePref;
            setLocale(next);
            saveUiPref('settings.locale', next);
            setI18nPref(next);
          }}
        >
          <option value="auto">跟随系统 / 跟隨系統 / Auto</option>{/* i18n:allow-zh */}
          <option value="zh-CN">简体中文</option>{/* i18n:allow-zh */}
          <option value="zh-TW">繁體中文</option>{/* i18n:allow-zh */}
          <option value="en">English</option>
        </select>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
          切换立即生效 / 切換立即生效 / Applies immediately{/* i18n:allow-zh — trilingual on purpose */}
        </div>
      </div>
      <div className="form-row" style={{ maxWidth: 320, marginTop: 14 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, textTransform: 'none' }}>
          <Palette size={14} />
          {t('主题')}
        </label>
        <select value={theme} onChange={(e) => applyTheme(e.target.value as ThemePref)}>
          <option value="dark">{t('深色（默认）')}</option>
          <option value="light">{t('浅色')}</option>
          <option value="auto">{t('跟随系统')}</option>
        </select>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
          {t('切换立即生效；日志与终端保持深色。重启后保留。')}
        </div>
      </div>

      <div className="section-title">{t('通知')}</div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, maxWidth: 420 }}>
        <input
          type="checkbox"
          checked={notifyExit}
          onChange={(e) => applyNotify(e.target.checked)}
          style={{ width: 13, height: 13 }}
        />
        <Bell size={13} />
        {t('容器异常退出（退出码非 0）时发送系统通知')}
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, maxWidth: 420, marginTop: 8 }}>
        <input
          type="checkbox"
          checked={autoReconnect}
          onChange={(e) => applyPref('settings.autoReconnect', e.target.checked, setAutoReconnect)}
          style={{ width: 13, height: 13 }}
        />
        <RefreshCw size={13} />
        {t('主机连接断开后自动重连（带退避，最多每分钟一次）')}
      </label>

      <div className="section-title">{t('窗口与启动')}</div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, maxWidth: 420 }}>
        <input
          type="checkbox"
          checked={minimizeToTray}
          onChange={(e) => {
            applyPref('settings.minimizeToTray', e.target.checked, setMinimizeToTray);
            window.dockerApi.setMinimizeToTray(e.target.checked);
          }}
          style={{ width: 13, height: 13 }}
        />
        {t('关闭窗口时最小化到系统托盘（退出请用托盘菜单）')}
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, maxWidth: 420, marginTop: 8 }}>
        <input
          type="checkbox"
          checked={autoLaunch}
          onChange={(e) => {
            applyPref('settings.autoLaunch', e.target.checked, setAutoLaunch);
            window.dockerApi.setAutoLaunch(e.target.checked);
          }}
          style={{ width: 13, height: 13 }}
        />
        {t('开机自动启动（仅安装版生效）')}
      </label>

      <div className="section-title">{t('刷新与数据')}</div>
      <div className="form-row" style={{ maxWidth: 420 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, textTransform: 'none' }}>
          <RefreshCw size={14} />
          {t('仪表板刷新间隔')}
        </label>
        <select
          value={pollIntervalMs}
          onChange={(e) => applyPref('settings.pollIntervalMs', Number(e.target.value), setPollIntervalMs)}
        >
          <option value={10000}>{t('10 秒（默认）')}</option>
          <option value={30000}>{t('30 秒')}</option>
          <option value={60000}>{t('60 秒')}</option>
          <option value={0}>{t('关闭（仅手动刷新）')}</option>
        </select>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
          {t('事件推送仍会实时刷新列表；此处控制仪表板的兜底轮询。')}
        </div>
      </div>
      <div className="form-row" style={{ maxWidth: 420 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, textTransform: 'none' }}>
          <ScrollText size={14} />
          {t('日志行数上限')}
        </label>
        <select
          value={logMaxLines}
          onChange={(e) => applyPref('settings.logMaxLines', Number(e.target.value), setLogMaxLines)}
        >
          <option value={2000}>{t('2,000 行')}</option>
          <option value={5000}>{t('5,000 行')}</option>
          <option value={8000}>{t('8,000 行（默认）')}</option>
          <option value={20000}>{t('20,000 行')}</option>
        </select>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
          {t('每个日志视图在内存中保留的最大行数，对新输出立即生效。')}
        </div>
      </div>
      <div className="form-row" style={{ maxWidth: 420 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, textTransform: 'none' }}>
          <List size={14} />
          {t('事件保留条数')}
        </label>
        <select
          value={eventMaxCount}
          onChange={(e) => {
            const n = Number(e.target.value);
            applyPref('settings.eventMaxCount', n, setEventMaxCount);
            // shrink (or grow) applies to the stored history immediately
            useAppStore.getState().trimRecentEvents(n);
          }}
        >
          <option value={20}>{t('20 条')}</option>
          <option value={40}>{t('40 条（默认）')}</option>
          <option value={100}>{t('100 条')}</option>
          <option value={200}>{t('200 条')}</option>
        </select>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
          {t('主页与仪表板「最近事件」列表的长度上限。')}
        </div>
      </div>

      <div className="section-title">{t('关于')}</div>
      <div style={{ fontSize: 12, color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Info size={13} /> {t('Dockyard ·')} {formatBuildLabel()}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.7 }}>
        {t('快捷键：Ctrl+P 打开命令面板 · 列表页 Ctrl+F 搜索 / F5 刷新 / Ctrl+A 全选 / Del 删除 ·')}
        {t('标签页中键关闭。连接凭据使用系统密钥库加密存储。')}
      </div>
    </div>
  );
}
