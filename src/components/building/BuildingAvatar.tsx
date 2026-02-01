import { cn } from '@/lib/utils';

interface BuildingAvatarProps {
  name: string;
  logoUrl?: string | null;
  avatarColor?: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

// Available avatar colors with their Tailwind classes and hex values
export const AVATAR_COLORS = [
  { name: 'Blue', class: 'bg-blue-500', hex: '#3b82f6' },
  { name: 'Green', class: 'bg-green-500', hex: '#22c55e' },
  { name: 'Purple', class: 'bg-purple-500', hex: '#a855f7' },
  { name: 'Orange', class: 'bg-orange-500', hex: '#f97316' },
  { name: 'Pink', class: 'bg-pink-500', hex: '#ec4899' },
  { name: 'Teal', class: 'bg-teal-500', hex: '#14b8a6' },
  { name: 'Indigo', class: 'bg-indigo-500', hex: '#6366f1' },
  { name: 'Cyan', class: 'bg-cyan-500', hex: '#06b6d4' },
  { name: 'Rose', class: 'bg-rose-500', hex: '#f43f5e' },
  { name: 'Amber', class: 'bg-amber-500', hex: '#f59e0b' },
  { name: 'Emerald', class: 'bg-emerald-500', hex: '#10b981' },
  { name: 'Slate', class: 'bg-slate-500', hex: '#64748b' },
];

// Generate initials from building name (max 2 characters)
function getInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

// Generate a consistent color based on the building name
function getColorFromName(name: string): { class: string; hex: string } {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// Get color by hex value or fall back to name-based color
function getAvatarColor(name: string, customColor?: string | null): { class: string; hex: string } {
  if (customColor) {
    const found = AVATAR_COLORS.find(c => c.hex === customColor);
    if (found) return found;
    // If it's a valid hex color, use it directly
    if (/^#[0-9A-Fa-f]{6}$/.test(customColor)) {
      return { class: '', hex: customColor };
    }
  }
  return getColorFromName(name);
}

const sizeClasses = {
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-16 h-16 text-xl',
};

export function BuildingAvatar({ name, logoUrl, avatarColor, size = 'md', className }: BuildingAvatarProps) {
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
  const color = getAvatarColor(name, avatarColor);

  // Use inline style for custom colors, Tailwind class for predefined ones
  const style = color.class ? undefined : { backgroundColor: color.hex };

  return (
    <div
      className={cn(
        'rounded-lg flex items-center justify-center font-semibold text-white',
        color.class,
        sizeClasses[size],
        className
      )}
      style={style}
      title={name}
    >
      {initials}
    </div>
  );
}

// Export utility for use in map popups (HTML string)
export function getBuildingAvatarHtml(
  name: string, 
  logoUrl?: string | null, 
  avatarColor?: string | null,
  size: 'sm' | 'md' | 'lg' = 'md'
): string {
  const sizeStyles = {
    sm: 'width: 32px; height: 32px; font-size: 12px;',
    md: 'width: 40px; height: 40px; font-size: 14px;',
    lg: 'width: 64px; height: 64px; font-size: 20px;',
  };

  if (logoUrl) {
    return `<img src="${logoUrl}" alt="${name}" class="rounded-lg object-cover border border-border" style="${sizeStyles[size]}" />`;
  }

  const initials = getInitials(name);
  const color = getAvatarColor(name, avatarColor);

  return `<div style="${sizeStyles[size]} background-color: ${color.hex}; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-weight: 600; color: white;" title="${name}">${initials}</div>`;
}
