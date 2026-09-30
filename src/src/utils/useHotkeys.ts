import { useEffect, useRef } from 'react';

type HotkeyHandler = (e: KeyboardEvent) => void;

/**
 * Bind keyboard shortcuts while the component is mounted.
 * `combo` examples: 'mod+f', 'f5', 'delete', 'ctrl+a'.
 * Handlers are ignored while typing in inputs unless the combo uses a modifier
 * (except Escape).
 */
export function useHotkeys(map: Record<string, HotkeyHandler>) {
  const mapRef = useRef(map);
  mapRef.current = map;

  useEffect(() => {
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
  }, []);
}
