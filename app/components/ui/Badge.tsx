'use client';

type BadgeVariant = 
  | 'standard' 
  | 'es' 
  | 'borderline' 
  | 'new'
  | 'pending'
  | 'reviewed'
  | 'converted'
  | 'rejected'
  | 'active'
  | 'paused'
  | 'solo'
  | 'growth'
  | 'multi_location';

interface BadgeProps {
  variant: BadgeVariant;
  children: React.ReactNode;
  icon?: React.ReactNode;
  testId?: string;
}

export function Badge({ variant, children, icon, testId }: BadgeProps) {
  const getVariantClasses = () => {
    switch (variant) {
      case 'standard':
        return 'badge-standard';
      case 'es':
        return 'badge-es';
      case 'borderline':
        return 'badge-borderline';
      case 'new':
        return 'bg-slate-100 text-slate-600 border-slate-200';
      case 'pending':
        return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'reviewed':
        return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'converted':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'rejected':
        return 'bg-red-50 text-red-700 border-red-200';
      case 'active':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'paused':
        return 'bg-slate-100 text-slate-600 border-slate-200';
      case 'solo':
        return 'bg-slate-100 text-slate-600 border-slate-200';
      case 'growth':
        return 'bg-teal-50 text-teal-700 border-teal-200';
      case 'multi_location':
        return 'bg-blue-50 text-blue-800 border-blue-200';
      default:
        return 'bg-slate-100 text-slate-600 border-slate-200';
    }
  };

  return (
    <span 
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${getVariantClasses()}`}
      data-testid={testId}
    >
      {icon}
      {children}
    </span>
  );
}

export function MarketBadge({ classification }: { classification: string | null }) {
  if (!classification) {
    return <Badge variant="new">Pending</Badge>;
  }
  
  const variant = classification.toLowerCase().replace('&', '').replace(' ', '') as BadgeVariant;
  const label = classification === 'E&S' ? 'E&S' : classification;
  
  return <Badge variant={variant === 'es' ? 'es' : variant}>{label}</Badge>;
}

export function StatusBadge({ status }: { status: string }) {
  const variant = status.toLowerCase().replace('_', '') as BadgeVariant;
  const label = status.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
  
  return <Badge variant={variant}>{label}</Badge>;
}
