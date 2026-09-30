import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface ContextMenuItem {
  key: string;
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
  /** nested flyout entries */
  children?: ContextMenuItem[];
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
    const x = Math.min(e.clientX, window.innerWidth - 220);
    const y = Math.min(e.clientY, window.innerHeight - items.length * 28 - 16);
    setMenu({ x, y, items });
  };

  const close = () => setMenu(null);

  return { menu, open, close };
}

function MenuList({
  items,
  onClose,
  depth = 0,
}: {
  items: ContextMenuItem[];
  onClose: () => void;
  depth?: number;
}) {
  const [openSub, setOpenSub] = useState<string | null>(null);

  return (
    <>
      {items.map((item) =>
        item.separator ? (
          <div key={item.key} className="context-menu-sep" />
        ) : item.children && item.children.length > 0 ? (
          <div
            key={item.key}
            className="context-menu-item has-sub"
            onMouseEnter={() => setOpenSub(item.key)}
            onMouseLeave={() => setOpenSub((k) => (k === item.key ? null : k))}
          >
            {item.icon && <span className="context-menu-icon">{item.icon}</span>}
            {item.label}
            <span className="context-menu-arrow">›</span>
            {openSub === item.key && (
              <div className="context-menu sub" style={{ left: '100%', top: -4 }}>
                <MenuList items={item.children} onClose={onClose} depth={depth + 1} />
              </div>
            )}
          </div>
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
    </>
  );
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
      <MenuList items={state.items} onClose={onClose} />
    </div>
  );
}
