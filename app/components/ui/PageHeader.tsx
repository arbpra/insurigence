'use client';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
      <div>
        <h1 
          className="text-2xl font-bold tracking-tight"
          style={{ color: 'var(--brand-primary)' }}
          data-testid="page-title"
        >
          {title}
        </h1>
        {subtitle && (
          <p 
            className="mt-1 text-sm"
            style={{ color: 'var(--brand-text-muted)' }}
            data-testid="page-subtitle"
          >
            {subtitle}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-3" data-testid="page-actions">
          {actions}
        </div>
      )}
    </div>
  );
}
