import { forwardRef } from 'react';

const VARIANTS = {
  primary:
    'bg-brand-600 text-white hover:bg-brand-500 disabled:bg-brand-600/50 shadow-sm shadow-brand-900/20',
  subtle:
    'bg-slate-200 text-slate-700 hover:bg-slate-300 dark:bg-ink-800 dark:text-slate-200 dark:hover:bg-ink-700',
  ghost:
    'bg-transparent text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-ink-800',
  danger:
    'bg-transparent text-rose-600 hover:bg-rose-500/10 dark:text-rose-400',
};

const SIZES = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-9 px-4 text-sm gap-2',
  icon: 'h-9 w-9 justify-center',
};

export const Spinner = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" className="animate-spin" aria-hidden="true">
    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" opacity="0.25" />
    <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="4" fill="none" strokeLinecap="round" />
  </svg>
);

export const Button = forwardRef(function Button(
  { variant = 'subtle', size = 'md', loading = false, className = '', children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={`focus-ring inline-flex items-center rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-70 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...props}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
});

export default Button;
