import Link from 'next/link';
import Image from 'next/image';
import logoImage from '@/attached_assets/image_1769205831692.png';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export default function Logo({ size = 'md', className = '' }: LogoProps) {
  const sizes = {
    sm: { height: 24, width: 140 },
    md: { height: 32, width: 180 },
    lg: { height: 44, width: 260 },
  };

  const { height, width } = sizes[size];

  return (
    <Link href="/" className={`flex items-center ${className}`} data-testid="logo-link">
      <Image
        src={logoImage}
        alt="Insurigence"
        height={height}
        width={width}
        priority
        style={{ objectFit: 'contain' }}
      />
    </Link>
  );
}
