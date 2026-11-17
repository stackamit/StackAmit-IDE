import { useCallback, useEffect, useRef } from 'react';
import { GripHorizontal } from 'lucide-react';

/**
 * Draggable horizontal divider controlling the editor/console split (as a
 * percentage of the main area). Pointer events give smooth, accessible resizing.
 */
export default function Splitter({ value, onChange }) {
  const dragging = useRef(false);
  const containerRef = useRef(null);

  const start = useCallback((e) => {
    dragging.current = true;
    e.preventDefault();
  }, []);

  useEffect(() => {
    const move = (e) => {
      if (!dragging.current) return;
      const main = document.querySelector('main');
      if (!main) return;
      const rect = main.getBoundingClientRect();
      const y = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
      const pct = Math.min(85, Math.max(15, (y / rect.height) * 100));
      onChange(pct);
    };
    const end = () => {
      dragging.current = false;
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', end);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', end);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', end);
    };
  }, [onChange]);

  return (
    <div
      ref={containerRef}
      role="separator"
      aria-orientation="horizontal"
      aria-valuenow={Math.round(value)}
      aria-valuemin={15}
      aria-valuemax={85}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp') onChange(Math.max(15, value - 3));
        if (e.key === 'ArrowDown') onChange(Math.min(85, value + 3));
      }}
      onMouseDown={start}
      onTouchStart={start}
      title="Drag to resize (or use ↑/↓)"
      className={`focus-ring flex h-2 shrink-0 cursor-row-resize items-center justify-center bg-slate-100 transition-colors hover:bg-brand-500/20 dark:bg-ink-850 ${
        dragging.current ? 'bg-brand-500/30' : ''
      }`}
    >
      <GripHorizontal size={14} className="text-slate-400 dark:text-slate-600" />
    </div>
  );
}
