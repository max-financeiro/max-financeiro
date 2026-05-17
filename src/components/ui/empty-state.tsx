import type { ReactNode } from 'react';
import { Card } from './card';

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <Card className="p-10 text-center">
      {icon && (
        <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-ink-100 text-ink-500 flex items-center justify-center">
          {icon}
        </div>
      )}
      <p className="text-heading-sm font-semibold text-ink-900">{title}</p>
      {description && <p className="mt-1.5 text-body-sm text-ink-500">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </Card>
  );
}
