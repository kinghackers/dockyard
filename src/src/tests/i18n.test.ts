// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { t, useI18n, resolveLocale } from '../i18n';

describe('i18n', () => {
  it('resolves auto locale from navigator.language', () => {
    const lang = Object.getOwnPropertyDescriptor(window.navigator, 'language');
    Object.defineProperty(window.navigator, 'language', { value: 'zh-TW', configurable: true });
    expect(resolveLocale('auto')).toBe('zh-TW');
    Object.defineProperty(window.navigator, 'language', { value: 'zh-CN', configurable: true });
    expect(resolveLocale('auto')).toBe('zh-CN');
    Object.defineProperty(window.navigator, 'language', { value: 'en-US', configurable: true });
    expect(resolveLocale('auto')).toBe('en');
    if (lang) Object.defineProperty(window.navigator, 'language', lang);
  });

  it('returns zh-CN source text by default', () => {
    useI18n.getState().setPref('zh-CN');
    expect(t('主页')).toBe('主页');
  });

  it('translates to English via the dictionary', () => {
    useI18n.getState().setPref('en');
    expect(t('主页')).toBe('Home');
    expect(t('启动')).toBe('Start');
  });

  it('falls back to zh-CN for unknown keys in English mode', () => {
    useI18n.getState().setPref('en');
    expect(t('未收录的字符串')).toBe('未收录的字符串');
  });

  it('substitutes {pN} params in every locale', () => {
    useI18n.getState().setPref('zh-CN');
    expect(t('已删除 {p0} 个容器', { p0: 3 })).toBe('已删除 3 个容器');
    useI18n.getState().setPref('en');
    expect(t('已删除 {p0} 个容器', { p0: 3 })).toBe('Deleted 3 containers');
  });

  it('converts to Traditional Chinese via OpenCC, leaving ASCII intact', () => {
    useI18n.getState().setPref('zh-TW');
    expect(t('设置')).toBe('設定');
    expect(t('已删除 {p0} 个容器', { p0: 3 })).toBe('已刪除 3 個容器');
    // params survive conversion
    expect(t('已连接 · v{p0}', { p0: '25.0' })).toBe('已連線 · v25.0');
  });

  it('treats undefined params as empty strings', () => {
    useI18n.getState().setPref('en');
    expect(t('已停止 {p0}', { p0: undefined })).toBe('Stopped ');
    useI18n.getState().setPref('zh-CN');
  });
});
