import { useState } from 'react';
import { Settings as SettingsIcon, Bell, Palette, Info } from 'lucide-react';
import { loadUiPref, saveUiPref } from '../../utils/uiPrefs';
import { formatBuildLabel } from '../../utils/buildInfo';

/**
 * App settings: theme, notifications. Values persist in localStorage and
 * apply immediately (theme) or on next trigger (notifications).
 */
export function SettingsPage() {
  const [theme, setTheme] = useState<'dark' | 'light'>(loadUiPref<'dark' | 'light'>('settings.theme', 'dark'));
  const [notifyExit, setNotifyExit] = useState(loadUiPref('settings.notifyAbnormalExit', true));

  const applyTheme = (next: 'dark' | 'light') => {
    setTheme(next);
    saveUiPref('settings.theme', next);
    document.documentElement.dataset.theme = next === 'light' ? 'light' : '';
  };

  const applyNotify = (next: boolean) => {
    setNotifyExit(next);
    saveUiPref('settings.notifyAbnormalExit', next);
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
