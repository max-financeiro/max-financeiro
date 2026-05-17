import type { HTMLAttributes } from 'react';
import { cn } from './cn';

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'pink' | 'ink';

const tones: Record<Tone, string> = {
  neutral: 'bg-ink-100 text-ink-700 border-ink-200',
  success: 'bg-success-50 text-success-700 border-success-100',
  warning: 'bg-warning-50 text-warning-700 border-warning-100',
  danger: 'bg-danger-50 text-danger-700 border-danger-100',
  info: 'bg-info-50 text-info-700 border-info-100',
  pink: 'bg-pink-50 text-pink-700 border-pink-100',
  ink: 'bg-ink-900 text-surface-raised border-ink-900',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  dot?: boolean;
}

export function Badge({ tone = 'neutral', dot, className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full',
        'text-caption font-medium border',
        tones[tone],
        className,
      )}
      {...props}
    >
      {dot && (
        <span
          className={cn(
            'w-1.5 h-1.5 rounded-full',
            tone === 'success' && 'bg-success-500',
            tone === 'warning' && 'bg-warning-500',
            tone === 'danger' && 'bg-danger-500',
            tone === 'info' && 'bg-info-500',
            tone === 'pink' && 'bg-pink-500',
            tone === 'neutral' && 'bg-ink-400',
            tone === 'ink' && 'bg-surface-raised',
          )}
        />
      )}
      {children}
    </span>
  );
}
