import { useState } from 'react';
import { BookOpenCheck } from 'lucide-react';
import { LOGO_SRC } from '../../config.js';

/**
 * Company logo mark. Renders client/public/logo.jpg when present and gracefully
 * falls back to the built-in gradient icon if the image is missing or fails to
 * load, so the brand block is never empty.
 */
export default function Logo({ size = 36, className = '', src = LOGO_SRC, alt = 'StackAmit logo' }) {
  const [failed, setFailed] = useState(false);
  const boxStyle = { width: size, height: size };

  if (!failed) {
    return (
      <img
        src={src || LOGO_SRC}
        alt={alt}
        onError={() => setFailed(true)}
        style={boxStyle}
        className={`shrink-0 rounded-lg object-cover ${className}`}
      />
    );
  }

  return (
    <span
      style={boxStyle}
      className={`flex shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-sm ${className}`}
      aria-hidden="true"
    >
      <BookOpenCheck size={Math.round(size * 0.55)} />
    </span>
  );
}
