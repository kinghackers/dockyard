import { useRef, useState } from 'react';

/**
 * Multi-select state for list pages: checkbox toggles, select-all,
 * and shift-click range selection over the currently visible rows.
 * The anchor row (focus) stays in the page; ranges are resolved by index.
 */
export function useMultiSelect() {
  const [checked, setChecked] = useState<Set<string>>(new Set());
  /** index of the last clicked row in the visible list — shift-range anchor */
  const lastIndexRef = useRef(-1);

  const toggle = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = (ids: string[]) => setChecked(new Set(ids));

  const clear = () => setChecked(new Set());

  const remove = (id: string) =>
    setChecked((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

  /** add every id between from/to (inclusive, order-agnostic) to the selection */
  const selectRange = (ids: string[], from: number, to: number) => {
    if (from < 0 || to < 0) return;
    const [a, b] = from < to ? [from, to] : [to, from];
    setChecked((prev) => {
      const next = new Set(prev);
      for (let i = a; i <= b; i++) next.add(ids[i]);
      return next;
    });
  };

  return { checked, setChecked, lastIndexRef, toggle, selectAll, clear, remove, selectRange };
}
