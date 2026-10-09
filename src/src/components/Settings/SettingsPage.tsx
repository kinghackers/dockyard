import { useState } from 'react';
import { Settings as SettingsIcon, Bell, Palette, Info, RefreshCw, ScrollText, List } from 'lucide-react';
import { loadUiPref, saveUiPref } from '../../utils/uiPrefs';
import { formatBuildLabel } from '../../utils/buildInfo';
import { useAppStore } from '../../stores/appStore';

/**
 * App settings: theme, notifications, polling & data limits. Values persist in
 * localStorage and apply immediately (theme) or on next trigger (the rest).
 */
export function SettingsPage() {
  const [theme, setTheme] = useState<'dark' | 'light'>(loadUiPref<'dark' | 'light'>('settings.theme', 'dark'));
  const [notifyExit, setNotifyExit] = useState(loadUiPref('settings.notifyAbnormalExit', true));
  const [pollIntervalMs, setPollIntervalMs] = useState(loadUiPref('settings.pollIntervalMs', 10000));
  const [logMaxLines, setLogMaxLines] = useState(loadUiPref('settings.logMaxLines', 8000));
  const [eventMaxCount, setEventMaxCount] = useState(loadUiPref('settings.eventMaxCount', 40));

  const applyTheme = (next: 'dark' | 'light') => {
    setTheme(next);
    saveUiPref('settings.theme', next);
    document.documentElement.dataset.theme = next === 'light' ? 'light' : '';
  };

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
          设置
        </div>
      </div>

      <div className="section-title">外观</div>
      <div className="form-row" style={{ maxWidth: 320 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, textTransform: 'none' }}>
          <Palette size={14} />
          主题
        </label>
        <select value={theme} onChange={(e) => applyTheme(e.target.value as 'dark' | 'light')}>
          <option value="dark">深色（默认）</option>
          <option value="light">浅色</option>
        </select>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
          切换立即生效；日志与终端保持深色。重启后保留。
        </div>
      </div>

      <div className="section-title">通知</div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, maxWidth: 420 }}>
        <input
          type="checkbox"
          checked={notifyExit}
          onChange={(e) => applyNotify(e.target.checked)}
          style={{ width: 13, height: 13 }}
        />
        <Bell size={13} />
        容器异常退出（退出码非 0）时发送系统通知
      </label>

      <div className="section-title">刷新与数据</div>
      <div className="form-row" style={{ maxWidth: 420 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, textTransform: 'none' }}>
          <RefreshCw size={14} />
          仪表板刷新间隔
        </label>
        <select
          value={pollIntervalMs}
          onChange={(e) => applyPref('settings.pollIntervalMs', Number(e.target.value), setPollIntervalMs)}
        >
          <option value={10000}>10 秒（默认）</option>
          <option value={30000}>30 秒</option>
          <option value={60000}>60 秒</option>
          <option value={0}>关闭（仅手动刷新）</option>
        </select>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
          事件推送仍会实时刷新列表；此处控制仪表板的兜底轮询。
        </div>
      </div>
      <div className="form-row" style={{ maxWidth: 420 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, textTransform: 'none' }}>
          <ScrollText size={14} />
          日志行数上限
        </label>
        <select
          value={logMaxLines}
          onChange={(e) => applyPref('settings.logMaxLines', Number(e.target.value), setLogMaxLines)}
        >
          <option value={2000}>2,000 行</option>
          <option value={5000}>5,000 行</option>
          <option value={8000}>8,000 行（默认）</option>
          <option value={20000}>20,000 行</option>
        </select>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
          每个日志视图在内存中保留的最大行数，对新输出立即生效。
        </div>
      </div>
      <div className="form-row" style={{ maxWidth: 420 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, textTransform: 'none' }}>
          <List size={14} />
          事件保留条数
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
          <option value={20}>20 条</option>
          <option value={40}>40 条（默认）</option>
          <option value={100}>100 条</option>
          <option value={200}>200 条</option>
        </select>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
          主页与仪表板「最近事件」列表的长度上限。
        </div>
      </div>

      <div className="section-title">关于</div>
      <div style={{ fontSize: 12, color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Info size={13} /> Docker 管理器 · {formatBuildLabel()}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.7 }}>
        快捷键：Ctrl+P 打开命令面板 · 列表页 Ctrl+F 搜索 / F5 刷新 / Ctrl+A 全选 / Del 删除 ·
        标签页中键关闭。连接凭据使用系统密钥库加密存储。
      </div>
    </div>
  );
}
