import { useCallback, useState } from 'react';

interface ResizeHandleProps {
  getStartValue: () => number;
  onValueChange: (value: number) => void;
  min: number;
  getMax: () => number;
  invert?: boolean;
}

export function ResizeHandle({
  getStartValue,
  onValueChange,
  min,
  getMax,
  invert = false,
}: ResizeHandleProps) {
  const [active, setActive] = useState(false);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startValue = getStartValue();

      const onMove = (ev: MouseEvent) => {
        const delta = ev.clientX - startX;
        const next = invert ? startValue - delta : startValue + delta;
        const max = getMax();
        onValueChange(Math.min(max, Math.max(min, next)));
      };

      const onUp = () => {
        setActive(false);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };

      setActive(true);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [getStartValue, onValueChange, min, getMax, invert]
  );

  return (
    <div
      className={`resize-handle${active ? ' active' : ''}`}
      onMouseDown={handleMouseDown}
      role="separator"
      aria-orientation="vertical"
    />
  );
}
