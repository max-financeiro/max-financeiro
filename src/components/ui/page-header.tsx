import { cn } from './cn';

export interface PageHeaderProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  eyebrow?: string;
}

export function PageHeader({ title, description, action, className, eyebrow }: PageHeaderProps) {
  return (
    <header className={cn('flex items-start justify-between gap-6 mb-8', className)}>
      <div className="min-w-0">
        {eyebrow && (
          <p className="text-micro font-semibold uppercase tracking-wider text-pink-700 mb-2">
            {eyebrow}
          </p>
        )}
        <h1 className="text-heading-lg font-semibold text-ink-900 tracking-tight">
          {title}
        </h1>
        {description && (
          <p className="mt-1.5 text-body-sm text-ink-500 max-w-2xl">{description}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}
