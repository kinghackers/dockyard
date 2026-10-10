import { create } from 'zustand';
import * as OpenCC from 'opencc-js';
import { en } from './en';

export type LocalePref = 'auto' | 'zh-CN' | 'zh-TW' | 'en';
export type EffectiveLocale = 'zh-CN' | 'zh-TW' | 'en';

/** Resolve the 'auto' preference from the OS/browser language. */
export function resolveLocale(pref: LocalePref): EffectiveLocale {
  if (pref === 'zh-CN' || pref === 'zh-TW' || pref === 'en') return pref;
  const lang = (typeof navigator !== 'undefined' ? navigator.language : 'zh-CN').toLowerCase();
  if (lang.startsWith('zh')) {
    return /tw|hk|hant|-mo/.test(lang) ? 'zh-TW' : 'zh-CN';
  }
  return 'en';
}

interface I18nState {
  pref: LocalePref;
  effective: EffectiveLocale;
  setPref: (pref: LocalePref) => void;
}

export const useI18n = create<I18nState>((set) => ({
  pref: 'auto',
  effective: 'zh-CN',
  setPref: (pref) => set({ pref, effective: resolveLocale(pref) }),
}));

// zh-CN → zh-TW via OpenCC (lazy converter + memo cache; keys are short so
// this is cheap). ASCII placeholders like {name} pass through untouched.
let s2t: ((s: string) => string) | null = null;
const tradCache = new Map<string, string>();
function toTraditional(text: string): string {
  const hit = tradCache.get(text);
  if (hit !== undefined) return hit;
  // cn→twp: Taiwan variant with local phrases (设置→設定, 内存→記憶體…)
  if (!s2t) s2t = OpenCC.Converter({ from: 'cn', to: 'twp' });
  const out = s2t(text);
  tradCache.set(text, out);
  return out;
}

/**
 * Translate a UI string. The key IS the zh-CN source text, so untranslated
 * entries fall back to simplified Chinese everywhere. `{name}`-style
 * placeholders are substituted from params.
 */
export function t(key: string, params?: Record<string, string | number | undefined>): string {
  const locale = useI18n.getState().effective;
  let out = key;
  if (locale === 'en') out = en[key] ?? key;
  else if (locale === 'zh-TW') out = toTraditional(key);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      out = out.split(`{${k}}`).join(String(v ?? ''));
    }
  }
  return out;
}

/** React binding: re-renders the caller when the locale changes. */
export function useT(): (key: string, params?: Record<string, string | number | undefined>) => string {
  useI18n((s) => s.effective);
  return t;
}
