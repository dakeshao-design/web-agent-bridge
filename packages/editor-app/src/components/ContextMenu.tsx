import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export type ContextMenuItem =
  | {
      type: 'item';
      id: string;
      label: string;
      disabled?: boolean;
      danger?: boolean;
      onClick: () => void;
    }
  | { type: 'separator'; id: string };

export interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

interface ContextMenuProps {
  menu: ContextMenuState | null;
  onClose: () => void;
}

export function ContextMenu({ menu, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const pad = 4;
    let x = menu.x;
    let y = menu.y;
    if (x + rect.width > window.innerWidth - pad) {
      x = Math.max(pad, window.innerWidth - rect.width - pad);
    }
    if (y + rect.height > window.innerHeight - pad) {
      y = Math.max(pad, window.innerHeight - rect.height - pad);
    }
    setPos({ x, y });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;

    const onPointerDown = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) return;
      onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onScroll = () => onClose();

    window.addEventListener('mousedown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('mousedown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [menu, onClose]);

  if (!menu) return null;

  return (
    <div
      ref={ref}
      className="context-menu"
      style={{ left: pos.x, top: pos.y }}
      role="menu"
    >
      {menu.items.map((item) => {
        if (item.type === 'separator') {
          return <div key={item.id} className="context-menu-separator" />;
        }
        return (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className={`context-menu-item ${item.danger ? 'danger' : ''}`}
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return;
              item.onClick();
              onClose();
            }}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
