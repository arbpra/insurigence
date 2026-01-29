'use client';

interface StatCardProps {
  label: string;
  value: number | string;
  icon?: React.ReactNode;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  variant?: 'default' | 'standard' | 'es' | 'borderline' | 'accent';
  testId?: string;
}

export function StatCard({ 
  label, 
  value, 
  icon,
  trend,
  variant = 'default',
  testId
}: StatCardProps) {
  const getVariantStyles = () => {
    switch (variant) {
      case 'standard':
        return {
          iconBg: 'var(--market-standard-bg)',
          iconColor: 'var(--market-standard)',
          valueColor: 'var(--market-standard)'
        };
      case 'es':
        return {
          iconBg: 'var(--market-es-bg)',
          iconColor: 'var(--market-es)',
          valueColor: 'var(--market-es)'
        };
      case 'borderline':
        return {
          iconBg: 'var(--market-borderline-bg)',
          iconColor: 'var(--market-borderline)',
          valueColor: 'var(--market-borderline)'
        };
      case 'accent':
        return {
          iconBg: '#E0F7F6',
          iconColor: 'var(--brand-accent)',
          valueColor: 'var(--brand-accent)'
        };
      default:
        return {
          iconBg: '#EBF0F5',
          iconColor: 'var(--brand-primary)',
          valueColor: 'var(--brand-primary)'
        };
    }
  };

  const styles = getVariantStyles();

  return (
    <div 
      className="bg-white rounded-xl border border-slate-200/80 p-5 shadow-sm"
      data-testid={testId}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <p 
            className="text-sm font-medium truncate"
            style={{ color: 'var(--brand-text-muted)' }}
          >
            {label}
          </p>
          <p 
            className="text-2xl font-bold mt-1"
            style={{ color: styles.valueColor }}
          >
            {value}
          </p>
          {trend && (
            <p className={`text-xs mt-1 font-medium ${trend.isPositive ? 'text-emerald-600' : 'text-red-600'}`}>
              {trend.isPositive ? '+' : ''}{trend.value}% from last month
            </p>
          )}
        </div>
        {icon && (
          <div 
            className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: styles.iconBg }}
          >
            <div style={{ color: styles.iconColor }}>
              {icon}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
