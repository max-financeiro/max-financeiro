import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from './cn';

type Tone = 'default' | 'raised' | 'pink' | 'sunken';

const tones: Record<Tone, string> = {
  default: 'bg-surface-raised border border-ink-200/70 shadow-xs',
  raised: 'bg-surface-raised border border-ink-200/50 shadow-md',
  pink: 'bg-pink-50 border border-pink-100',
  sunken: 'bg-surface-sunken border border-ink-200/40',
};

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  tone?: Tone;
  padded?: boolean;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { tone = 'default', padded = false, className, children, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        'rounded-xl',
        tones[tone],
        padded && 'p-5',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
});

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4 px-5 pt-5', className)}>
      <div>
        <h3 className="text-heading-sm font-semibold text-ink-900">{title}</h3>
        {description && <p className="text-body-sm text-ink-500 mt-1">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
