import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from './cn';

type Variant = 'primary' | 'pink' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const variants: Record<Variant, string> = {
  primary: 'bg-ink-900 text-surface-raised hover:bg-ink-700',
  pink: 'bg-pink-600 text-white hover:bg-pink-700 shadow-sm hover:shadow-md',
  secondary: 'bg-surface-raised text-ink-900 border border-ink-200 hover:bg-ink-50 hover:border-ink-300',
  ghost: 'text-ink-700 hover:bg-ink-100 hover:text-ink-900',
  danger: 'bg-danger-600 text-white hover:bg-danger-700',
};

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-caption rounded-md',
  md: 'h-10 px-4 text-body-sm rounded-lg',
  lg: 'h-12 px-5 text-body rounded-lg',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', className, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center gap-2 font-medium',
        'transition-all duration-150 ease-out-expo',
        'active:scale-[0.98]',
        'disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
});
