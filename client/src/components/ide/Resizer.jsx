import { useCallback, useEffect, useRef } from 'react';

/**
 * Pointer-driven resizer. `orientation="vertical"` drags horizontally (changes a
 * width); `orientation="horizontal"` drags vertically (changes a height).
 * `size` is the current pixel size; `onResize` receives the next clamped size.
 */
export default function Resizer({ orientation = 'vertical', size = 0, onResize, min = 120, max = 1200 }) {
  const drag = useRef({ active: false, pointerId: null, startPos: 0, base: 0 });

  const onMouseDown = useCallback(
    (e) => {
      drag.current = {
        active: true,
        pointerId: e.pointerId ?? null,
        startPos: orientation === 'vertical' ? e.clientX : e.clientY,
        base: size,
      };
      e.currentTarget.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    },
    [orientation, size],
  );

  useEffect(() => {
    const move = (e) => {
      if (!drag.current.active || (drag.current.pointerId !== null && e.pointerId !== drag.current.pointerId)) return;
      const cur = orientation === 'vertical' ? e.clientX : e.clientY;
      const delta = cur - drag.current.startPos;
      // The resizable panels are anchored to the right/bottom edge. Moving the
      // divider right/down therefore makes the panel smaller, not larger.
      onResize?.(Math.min(max, Math.max(min, drag.current.base - delta)));
    };
    const up = (e) => {
      if (drag.current.pointerId !== null && e.pointerId !== drag.current.pointerId) return;
      drag.current.active = false;
      drag.current.pointerId = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [orientation, onResize, min, max]);

  const vertical = orientation === 'vertical';
  return (
    <div
      role="separator"
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      aria-valuenow={Math.round(size)}
      tabIndex={0}
      onPointerDown={onMouseDown}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') onResize?.(Math.min(max, size + 12));
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') onResize?.(Math.max(min, size - 12));
      }}
      title="Drag to resize"
      className={`shrink-0 bg-slate-200 transition-colors hover:bg-brand-500/40 focus-visible:bg-brand-500/50 dark:bg-ink-800 ${
        vertical ? 'w-1 cursor-col-resize' : 'h-1 cursor-row-resize'
      }`}
    />
  );
}
