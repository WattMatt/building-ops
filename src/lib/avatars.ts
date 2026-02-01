// Enhanced avatar library with extended DiceBear styles and customization options

export interface AvatarOption {
  id: string;
  name: string;
  url: string | null;
  category: AvatarCategory;
}

export type AvatarCategory = 
  | 'initials' 
  | 'adventurer' 
  | 'lorelei' 
  | 'notionists' 
  | 'fun' 
  | 'bottts' 
  | 'shapes' 
  | 'personas'
  | 'building';

// Background color palette
export const AVATAR_BACKGROUNDS = [
  { id: 'sky', name: 'Sky Blue', value: 'b6e3f4' },
  { id: 'lavender', name: 'Lavender', value: 'c0aede' },
  { id: 'rose', name: 'Rose', value: 'ffd5dc' },
  { id: 'periwinkle', name: 'Periwinkle', value: 'd1d4f9' },
  { id: 'peach', name: 'Peach', value: 'ffdfbf' },
  { id: 'mint', name: 'Mint', value: 'b8e6c4' },
  { id: 'coral', name: 'Coral', value: 'ffb5a7' },
  { id: 'lemon', name: 'Lemon', value: 'fef3c7' },
  { id: 'slate', name: 'Slate', value: 'cbd5e1' },
  { id: 'transparent', name: 'None', value: 'transparent' },
];

// Avatar style options for customization
export type AvatarStyle = 'adventurer' | 'lorelei' | 'notionists' | 'fun-emoji' | 'bottts' | 'shapes' | 'personas' | 'thumbs' | 'pixel-art' | 'icons';

export const AVATAR_STYLES: { id: AvatarStyle; label: string; description: string }[] = [
  { id: 'adventurer', label: 'Adventurer', description: 'Friendly illustrated characters' },
  { id: 'lorelei', label: 'Elegant', description: 'Sophisticated portraits' },
  { id: 'notionists', label: 'Minimalist', description: 'Clean, simple style' },
  { id: 'bottts', label: 'Robots', description: 'Cute robot avatars' },
  { id: 'shapes', label: 'Geometric', description: 'Abstract shape patterns' },
  { id: 'personas', label: 'Personas', description: 'Modern character illustrations' },
  { id: 'fun-emoji', label: 'Fun Emoji', description: 'Playful emoji faces' },
  { id: 'thumbs', label: 'Thumbs', description: 'Fun hand gestures' },
  { id: 'pixel-art', label: 'Pixel Art', description: 'Retro pixel style' },
  { id: 'icons', label: 'Icons', description: 'Simple icon avatars' },
];

// Adventurer style - friendly illustrated characters
const ADVENTURER_AVATARS: AvatarOption[] = [
  { id: 'adv-1', name: 'Alex', url: 'https://api.dicebear.com/7.x/adventurer/svg?seed=Alex&backgroundColor=b6e3f4', category: 'adventurer' },
  { id: 'adv-2', name: 'Jordan', url: 'https://api.dicebear.com/7.x/adventurer/svg?seed=Jordan&backgroundColor=c0aede', category: 'adventurer' },
  { id: 'adv-3', name: 'Taylor', url: 'https://api.dicebear.com/7.x/adventurer/svg?seed=Taylor&backgroundColor=ffd5dc', category: 'adventurer' },
  { id: 'adv-4', name: 'Morgan', url: 'https://api.dicebear.com/7.x/adventurer/svg?seed=Morgan&backgroundColor=d1d4f9', category: 'adventurer' },
  { id: 'adv-5', name: 'Casey', url: 'https://api.dicebear.com/7.x/adventurer/svg?seed=Casey&backgroundColor=ffdfbf', category: 'adventurer' },
  { id: 'adv-6', name: 'Riley', url: 'https://api.dicebear.com/7.x/adventurer/svg?seed=Riley&backgroundColor=b8e6c4', category: 'adventurer' },
];

// Lorelei style - elegant illustrated characters
const LORELEI_AVATARS: AvatarOption[] = [
  { id: 'lor-1', name: 'Sophie', url: 'https://api.dicebear.com/7.x/lorelei/svg?seed=Sophie&backgroundColor=ffd5dc', category: 'lorelei' },
  { id: 'lor-2', name: 'Marcus', url: 'https://api.dicebear.com/7.x/lorelei/svg?seed=Marcus&backgroundColor=b6e3f4', category: 'lorelei' },
  { id: 'lor-3', name: 'Emma', url: 'https://api.dicebear.com/7.x/lorelei/svg?seed=Emma&backgroundColor=c0aede', category: 'lorelei' },
  { id: 'lor-4', name: 'David', url: 'https://api.dicebear.com/7.x/lorelei/svg?seed=David&backgroundColor=d1d4f9', category: 'lorelei' },
  { id: 'lor-5', name: 'Lily', url: 'https://api.dicebear.com/7.x/lorelei/svg?seed=Lily&backgroundColor=ffdfbf', category: 'lorelei' },
  { id: 'lor-6', name: 'James', url: 'https://api.dicebear.com/7.x/lorelei/svg?seed=James&backgroundColor=b8e6c4', category: 'lorelei' },
];

// Notionists style - minimalist cartoon style
const NOTIONISTS_AVATARS: AvatarOption[] = [
  { id: 'not-1', name: 'Sam', url: 'https://api.dicebear.com/7.x/notionists/svg?seed=Sam&backgroundColor=b6e3f4', category: 'notionists' },
  { id: 'not-2', name: 'Jamie', url: 'https://api.dicebear.com/7.x/notionists/svg?seed=Jamie&backgroundColor=c0aede', category: 'notionists' },
  { id: 'not-3', name: 'Chris', url: 'https://api.dicebear.com/7.x/notionists/svg?seed=Chris&backgroundColor=ffd5dc', category: 'notionists' },
  { id: 'not-4', name: 'Pat', url: 'https://api.dicebear.com/7.x/notionists/svg?seed=Pat&backgroundColor=d1d4f9', category: 'notionists' },
  { id: 'not-5', name: 'Drew', url: 'https://api.dicebear.com/7.x/notionists/svg?seed=Drew&backgroundColor=ffdfbf', category: 'notionists' },
  { id: 'not-6', name: 'Quinn', url: 'https://api.dicebear.com/7.x/notionists/svg?seed=Quinn&backgroundColor=b8e6c4', category: 'notionists' },
];

// Fun style - playful avatars
const FUN_AVATARS: AvatarOption[] = [
  { id: 'fun-1', name: 'Pixel Hero', url: 'https://api.dicebear.com/7.x/pixel-art/svg?seed=hero&backgroundColor=b6e3f4', category: 'fun' },
  { id: 'fun-2', name: 'Thumbs Up', url: 'https://api.dicebear.com/7.x/thumbs/svg?seed=thumbs&backgroundColor=ffdfbf', category: 'fun' },
  { id: 'fun-3', name: 'Big Ears', url: 'https://api.dicebear.com/7.x/big-ears/svg?seed=ears&backgroundColor=ffd5dc', category: 'fun' },
  { id: 'fun-4', name: 'Fun Face', url: 'https://api.dicebear.com/7.x/fun-emoji/svg?seed=face&backgroundColor=c0aede', category: 'fun' },
  { id: 'fun-5', name: 'Croodles', url: 'https://api.dicebear.com/7.x/croodles/svg?seed=doodle&backgroundColor=b8e6c4', category: 'fun' },
  { id: 'fun-6', name: 'Micah', url: 'https://api.dicebear.com/7.x/micah/svg?seed=micah&backgroundColor=d1d4f9', category: 'fun' },
];

// NEW: Bottts style - cute robot avatars
const BOTTTS_AVATARS: AvatarOption[] = [
  { id: 'bot-1', name: 'Beep', url: 'https://api.dicebear.com/7.x/bottts/svg?seed=Beep&backgroundColor=b6e3f4', category: 'bottts' },
  { id: 'bot-2', name: 'Boop', url: 'https://api.dicebear.com/7.x/bottts/svg?seed=Boop&backgroundColor=c0aede', category: 'bottts' },
  { id: 'bot-3', name: 'Circuit', url: 'https://api.dicebear.com/7.x/bottts/svg?seed=Circuit&backgroundColor=ffd5dc', category: 'bottts' },
  { id: 'bot-4', name: 'Spark', url: 'https://api.dicebear.com/7.x/bottts/svg?seed=Spark&backgroundColor=d1d4f9', category: 'bottts' },
  { id: 'bot-5', name: 'Bolt', url: 'https://api.dicebear.com/7.x/bottts/svg?seed=Bolt&backgroundColor=ffdfbf', category: 'bottts' },
  { id: 'bot-6', name: 'Chip', url: 'https://api.dicebear.com/7.x/bottts/svg?seed=Chip&backgroundColor=b8e6c4', category: 'bottts' },
];

// NEW: Shapes style - geometric abstract patterns
const SHAPES_AVATARS: AvatarOption[] = [
  { id: 'shp-1', name: 'Prism', url: 'https://api.dicebear.com/7.x/shapes/svg?seed=Prism&backgroundColor=b6e3f4', category: 'shapes' },
  { id: 'shp-2', name: 'Vertex', url: 'https://api.dicebear.com/7.x/shapes/svg?seed=Vertex&backgroundColor=c0aede', category: 'shapes' },
  { id: 'shp-3', name: 'Facet', url: 'https://api.dicebear.com/7.x/shapes/svg?seed=Facet&backgroundColor=ffd5dc', category: 'shapes' },
  { id: 'shp-4', name: 'Edge', url: 'https://api.dicebear.com/7.x/shapes/svg?seed=Edge&backgroundColor=d1d4f9', category: 'shapes' },
  { id: 'shp-5', name: 'Plane', url: 'https://api.dicebear.com/7.x/shapes/svg?seed=Plane&backgroundColor=ffdfbf', category: 'shapes' },
  { id: 'shp-6', name: 'Cube', url: 'https://api.dicebear.com/7.x/shapes/svg?seed=Cube&backgroundColor=b8e6c4', category: 'shapes' },
];

// NEW: Personas style - modern character illustrations  
const PERSONAS_AVATARS: AvatarOption[] = [
  { id: 'per-1', name: 'Nova', url: 'https://api.dicebear.com/7.x/personas/svg?seed=Nova&backgroundColor=b6e3f4', category: 'personas' },
  { id: 'per-2', name: 'Atlas', url: 'https://api.dicebear.com/7.x/personas/svg?seed=Atlas&backgroundColor=c0aede', category: 'personas' },
  { id: 'per-3', name: 'Luna', url: 'https://api.dicebear.com/7.x/personas/svg?seed=Luna&backgroundColor=ffd5dc', category: 'personas' },
  { id: 'per-4', name: 'Orion', url: 'https://api.dicebear.com/7.x/personas/svg?seed=Orion&backgroundColor=d1d4f9', category: 'personas' },
  { id: 'per-5', name: 'Stella', url: 'https://api.dicebear.com/7.x/personas/svg?seed=Stella&backgroundColor=ffdfbf', category: 'personas' },
  { id: 'per-6', name: 'Phoenix', url: 'https://api.dicebear.com/7.x/personas/svg?seed=Phoenix&backgroundColor=b8e6c4', category: 'personas' },
];

// NEW: Building-specific avatars using icons and identicons
const BUILDING_AVATARS: AvatarOption[] = [
  { id: 'bld-1', name: 'Tower', url: 'https://api.dicebear.com/7.x/identicon/svg?seed=Tower&backgroundColor=b6e3f4', category: 'building' },
  { id: 'bld-2', name: 'Plaza', url: 'https://api.dicebear.com/7.x/identicon/svg?seed=Plaza&backgroundColor=c0aede', category: 'building' },
  { id: 'bld-3', name: 'Centre', url: 'https://api.dicebear.com/7.x/identicon/svg?seed=Centre&backgroundColor=ffd5dc', category: 'building' },
  { id: 'bld-4', name: 'Heights', url: 'https://api.dicebear.com/7.x/identicon/svg?seed=Heights&backgroundColor=d1d4f9', category: 'building' },
  { id: 'bld-5', name: 'Complex', url: 'https://api.dicebear.com/7.x/identicon/svg?seed=Complex&backgroundColor=ffdfbf', category: 'building' },
  { id: 'bld-6', name: 'Estate', url: 'https://api.dicebear.com/7.x/identicon/svg?seed=Estate&backgroundColor=b8e6c4', category: 'building' },
  { id: 'bld-7', name: 'Manor', url: 'https://api.dicebear.com/7.x/shapes/svg?seed=Manor&backgroundColor=b6e3f4', category: 'building' },
  { id: 'bld-8', name: 'Square', url: 'https://api.dicebear.com/7.x/shapes/svg?seed=Square&backgroundColor=c0aede', category: 'building' },
  { id: 'bld-9', name: 'Park', url: 'https://api.dicebear.com/7.x/shapes/svg?seed=Park&backgroundColor=ffd5dc', category: 'building' },
  { id: 'bld-10', name: 'Gardens', url: 'https://api.dicebear.com/7.x/shapes/svg?seed=Gardens&backgroundColor=d1d4f9', category: 'building' },
  { id: 'bld-11', name: 'Court', url: 'https://api.dicebear.com/7.x/shapes/svg?seed=Court&backgroundColor=ffdfbf', category: 'building' },
  { id: 'bld-12', name: 'Vista', url: 'https://api.dicebear.com/7.x/shapes/svg?seed=Vista&backgroundColor=b8e6c4', category: 'building' },
];

// Combined cartoon avatars (user profiles)
export const CARTOON_AVATARS: AvatarOption[] = [
  ...ADVENTURER_AVATARS,
  ...LORELEI_AVATARS,
  ...NOTIONISTS_AVATARS,
  ...FUN_AVATARS,
  ...BOTTTS_AVATARS,
  ...SHAPES_AVATARS,
  ...PERSONAS_AVATARS,
];

// Category labels for display
export const AVATAR_CATEGORIES = {
  adventurer: { label: 'Adventurer', description: 'Friendly illustrated characters' },
  lorelei: { label: 'Elegant', description: 'Sophisticated character portraits' },
  notionists: { label: 'Minimalist', description: 'Clean, simple cartoon style' },
  fun: { label: 'Fun & Playful', description: 'Unique and quirky styles' },
  bottts: { label: 'Robots', description: 'Cute robot avatars' },
  shapes: { label: 'Geometric', description: 'Abstract shape patterns' },
  personas: { label: 'Personas', description: 'Modern character illustrations' },
} as const;

// Building avatar category
export const BUILDING_AVATAR_CATEGORIES = {
  building: { label: 'Buildings', description: 'Geometric patterns for buildings' },
} as const;

// Legacy export for backwards compatibility
export const DEFAULT_AVATARS = [
  {
    id: 'initials',
    name: 'Initials',
    url: null,
    category: 'initials' as const,
  },
  ...CARTOON_AVATARS.slice(0, 8),
];

// Generate a custom avatar with specific options
export interface AvatarGenerationOptions {
  seed: string;
  style: AvatarStyle;
  backgroundColor?: string;
  scale?: number;
  flip?: boolean;
  rotate?: number;
}

export function generateCustomAvatar(options: AvatarGenerationOptions): string {
  const { seed, style, backgroundColor = 'b6e3f4', scale = 100, flip = false, rotate = 0 } = options;
  const params = new URLSearchParams({
    seed: encodeURIComponent(seed),
    backgroundColor,
    scale: scale.toString(),
    flip: flip.toString(),
    rotate: rotate.toString(),
  });
  return `https://api.dicebear.com/7.x/${style}/svg?${params.toString()}`;
}

// Generate a random avatar with a specific style
export function generateRandomAvatar(
  seed: string, 
  style: AvatarStyle = 'adventurer',
  backgroundColor?: string
): string {
  const bg = backgroundColor || AVATAR_BACKGROUNDS[Math.floor(Math.random() * (AVATAR_BACKGROUNDS.length - 1))].value;
  return generateCustomAvatar({ seed, style, backgroundColor: bg });
}

// Get avatars by category
export function getAvatarsByCategory(category: keyof typeof AVATAR_CATEGORIES): AvatarOption[] {
  return CARTOON_AVATARS.filter(avatar => avatar.category === category);
}

// Get building avatars
export function getBuildingAvatars(): AvatarOption[] {
  return BUILDING_AVATARS;
}

// Get all cartoon avatars
export function getAllCartoonAvatars(): AvatarOption[] {
  return CARTOON_AVATARS;
}

// Parse avatar URL to extract customization options
export function parseAvatarUrl(url: string): AvatarGenerationOptions | null {
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/');
    const styleIndex = pathParts.indexOf('7.x');
    if (styleIndex === -1 || styleIndex + 1 >= pathParts.length) return null;
    
    const stylePart = pathParts[styleIndex + 1];
    const style = stylePart.replace('/svg', '') as AvatarStyle;
    
    const params = urlObj.searchParams;
    return {
      seed: decodeURIComponent(params.get('seed') || ''),
      style,
      backgroundColor: params.get('backgroundColor') || 'b6e3f4',
      scale: parseInt(params.get('scale') || '100'),
      flip: params.get('flip') === 'true',
      rotate: parseInt(params.get('rotate') || '0'),
    };
  } catch {
    return null;
  }
}
