import { cn } from './cn';
import { Card } from './card';

type Tone = 'neutral' | 'pink' | 'success' | 'warning' | 'danger' | 'info';

const accentBar: Record<Tone, string> = {
  neutral: 'bg-ink-300',
  pink: 'bg-pink-500',
  success: 'bg-success-500',
  warning: 'bg-warning-500',
  danger: 'bg-danger-500',
  info: 'bg-info-500',
};

const labelColor: Record<Tone, string> = {
  neutral: 'text-ink-500',
  pink: 'text-pink-700',
  success: 'text-success-700',
  warning: 'text-warning-700',
  danger: 'text-danger-700',
  info: 'text-info-700',
};

export interface KpiCardProps {
  label: string;
  value: string;
  subtitle?: string;
  tone?: Tone;
  trend?: { value: string; positive?: boolean };
  className?: string;
}

export function KpiCard({ label, value, subtitle, tone = 'neutral', trend, className }: KpiCardProps) {
  return (
    <Card className={cn('relative overflow-hidden p-5', className)}>
      {/* Accent vertical bar à esquerda */}
      <span className={cn('absolute left-0 top-0 bottom-0 w-1', accentBar[tone])} />

      <div className="flex items-start justify-between gap-3">
        <p className={cn('text-micro font-semibold uppercase tracking-wide', labelColor[tone])}>
          {label}
        </p>
        {trend && (
          <span
            className={cn(
              'text-caption font-mono',
              trend.positive ? 'text-success-700' : 'text-danger-700',
            )}
          >
            {trend.positive ? '↑' : '↓'} {trend.value}
          </span>
        )}
      </div>

      <p className="mt-3 text-display-sm font-semibold text-ink-900 nums tracking-tight">
        {value}
      </p>

      {subtitle && <p className="mt-1 text-caption text-ink-500">{subtitle}</p>}
    </Card>
  );
}
