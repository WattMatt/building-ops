import { Building2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BuildingAvatarProps {
  name: string;
  logoUrl?: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

// Generate initials from building name (max 2 characters)
function getInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

// Generate a consistent color based on the building name
function getColorFromName(name: string): string {
  const colors = [
    'bg-blue-500',
    'bg-green-500',
    'bg-purple-500',
    'bg-orange-500',
    'bg-pink-500',
    'bg-teal-500',
    'bg-indigo-500',
    'bg-cyan-500',
    'bg-rose-500',
    'bg-amber-500',
  ];
  
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  return colors[Math.abs(hash) % colors.length];
}

const sizeClasses = {
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-16 h-16 text-xl',
};

export function BuildingAvatar({ name, logoUrl, size = 'md', className }: BuildingAvatarProps) {
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt={`${name} logo`}
        className={cn(
          'rounded-lg object-cover border border-border',
          sizeClasses[size],
          className
        )}
      />
    );
  }

  const initials = getInitials(name);
  const bgColor = getColorFromName(name);

  return (
    <div
      className={cn(
        'rounded-lg flex items-center justify-center font-semibold text-white',
        bgColor,
        sizeClasses[size],
        className
      )}
      title={name}
    >
      {initials}
    </div>
  );
}

// Export utility for use in map popups (HTML string)
export function getBuildingAvatarHtml(name: string, logoUrl?: string | null, size: 'sm' | 'md' | 'lg' = 'md'): string {
  const sizeStyles = {
    sm: 'width: 32px; height: 32px; font-size: 12px;',
    md: 'width: 40px; height: 40px; font-size: 14px;',
    lg: 'width: 64px; height: 64px; font-size: 20px;',
  };

  if (logoUrl) {
    return `<img src="${logoUrl}" alt="${name}" class="rounded-lg object-cover border border-border" style="${sizeStyles[size]}" />`;
  }

  const initials = getInitials(name);
  const colors = [
    '#3b82f6', '#22c55e', '#a855f7', '#f97316', '#ec4899',
    '#14b8a6', '#6366f1', '#06b6d4', '#f43f5e', '#f59e0b',
  ];
  
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const bgColor = colors[Math.abs(hash) % colors.length];

  return `<div style="${sizeStyles[size]} background-color: ${bgColor}; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-weight: 600; color: white;" title="${name}">${initials}</div>`;
}
