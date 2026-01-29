'use client';

import Link from 'next/link';

type ButtonVariant = 'primary' | 'secondary' | 'accent' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

interface ButtonBaseProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: React.ReactNode;
  disabled?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  testId?: string;
  className?: string;
}

interface ButtonAsButtonProps extends ButtonBaseProps {
  href?: never;
  onClick?: () => void;
  type?: 'button' | 'submit';
}

interface ButtonAsLinkProps extends ButtonBaseProps {
  href: string;
  onClick?: never;
  type?: never;
}

type ButtonProps = ButtonAsButtonProps | ButtonAsLinkProps;

export function Button({
  variant = 'primary',
  size = 'md',
  children,
  disabled = false,
  loading = false,
  icon,
  testId,
  className = '',
  href,
  onClick,
  type = 'button',
}: ButtonProps) {
  const getVariantClasses = () => {
    switch (variant) {
      case 'primary':
        return 'btn-brand-primary';
      case 'secondary':
        return 'btn-brand-secondary';
      case 'accent':
        return 'btn-brand-accent';
      case 'ghost':
        return 'bg-transparent hover:bg-slate-100 text-slate-600 hover:text-slate-800';
      case 'danger':
        return 'bg-red-600 text-white hover:bg-red-700';
      default:
        return 'btn-brand-primary';
    }
  };

  const getSizeClasses = () => {
    switch (size) {
      case 'sm':
        return 'px-3 py-1.5 text-xs';
      case 'md':
        return 'px-4 py-2';
      case 'lg':
        return 'px-6 py-3';
      case 'icon':
        return 'w-9 h-9 p-0';
      default:
        return 'px-4 py-2';
    }
  };

  const baseClasses = `
    inline-flex items-center justify-center gap-2 rounded-lg font-medium
    transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-offset-2
    disabled:opacity-50 disabled:cursor-not-allowed
    ${getVariantClasses()}
    ${getSizeClasses()}
    ${className}
  `.trim().replace(/\s+/g, ' ');

  const content = (
    <>
      {loading ? (
        <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
      ) : icon}
      {size !== 'icon' && children}
    </>
  );

  if (href) {
    return (
      <Link href={href} className={baseClasses} data-testid={testId}>
        {content}
      </Link>
    );
  }

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={baseClasses}
      data-testid={testId}
    >
      {content}
    </button>
  );
}
