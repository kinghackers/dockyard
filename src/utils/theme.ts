export type ThemePref = 'dark' | 'light' | 'auto';

/** Resolve and apply the effective theme for a preference. */
export function applyTheme(pref: ThemePref) {
  const dark =
    pref === 'dark' ||
    (pref === 'auto' && !window.matchMedia('(prefers-color-scheme: light)').matches);
  document.documentElement.dataset.theme = dark ? '' : 'light';
}

/**
 * Watch for OS scheme changes while the preference is 'auto'.
 * Returns a cleanup function.
 */
export function watchTheme(pref: ThemePref): () => void {
  if (pref !== 'auto') return () => {};
  const mq = window.matchMedia('(prefers-color-scheme: light)');
  const onChange = () => applyTheme('auto');
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}
