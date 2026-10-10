import { useEffect, useRef } from 'react';

type HotkeyHandler = (e: KeyboardEvent) => void;

/**
 * Bind keyboard shortcuts while the component is mounted and active.
 * `combo` examples: 'mod+f', 'f5', 'delete', 'ctrl+a'.
 * Handlers are ignored while typing in inputs unless the combo uses a modifier
 * (except Escape). Keep-alive pages stay mounted while hidden — pass their
 * `active` flag so a hidden surface cannot steal shortcuts (invisible F5,
 * delete-confirm dialogs, selection mutations) from the visible one.
 */
export function useHotkeys(map: Record<string, HotkeyHandler>, active = true) {
  const mapRef = useRef(map);
  mapRef.current = map;

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      const combo = [
        e.ctrlKey || e.metaKey ? 'mod' : '',
        e.altKey ? 'alt' : '',
        e.shiftKey ? 'shift' : '',
        e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase(),
      ]
        .filter(Boolean)
        .join('+');

      const handler = mapRef.current[combo];
      if (!handler) return;

      // bare keys (f5, delete…) should not steal keystrokes from text fields
      const bare = !combo.startsWith('mod') && !combo.includes('+');
      if (typing && bare && e.key !== 'Escape') return;

      e.preventDefault();
      handler(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);
}
