import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface ContextMenuItem {
  key: string;
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
  onSelect: () => void;
}

export interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

/** Lightweight right-click menu. Call open() from onContextMenu handlers. */
export function useContextMenu() {
  const [menu, setMenu] = useState<ContextMenuState | null>(null);

  const open = (e: React.MouseEvent, items: ContextMenuItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    // keep inside viewport
    const x = Math.min(e.clientX, window.innerWidth - 200);
    const y = Math.min(e.clientY, window.innerHeight - items.length * 28 - 16);
    setMenu({ x, y, items });
  };

  const close = () => setMenu(null);

  return { menu, open, close };
}

export function ContextMenu({ state, onClose }: { state: ContextMenuState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="context-menu"
      style={{ left: state.x, top: state.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {state.items.map((item) =>
        item.separator ? (
          <div key={item.key} className="context-menu-sep" />
        ) : (
          <button
            key={item.key}
            className={`context-menu-item ${item.danger ? 'danger' : ''}`}
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            {item.icon && <span className="context-menu-icon">{item.icon}</span>}
            {item.label}
          </button>
        )
      )}
    </div>
  );
}
