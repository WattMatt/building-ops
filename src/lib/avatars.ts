// Default avatar options using DiceBear API with cartoon character styles

export interface AvatarOption {
  id: string;
  name: string;
  url: string | null;
  category: 'initials' | 'cartoon' | 'adventurer' | 'lorelei' | 'notionists' | 'fun';
}

// Cartoon character avatars - diverse and friendly illustrated characters
export const CARTOON_AVATARS: AvatarOption[] = [
  // Adventurer style - friendly illustrated characters
  {
    id: 'adv-1',
    name: 'Alex',
    url: 'https://api.dicebear.com/7.x/adventurer/svg?seed=Alex&backgroundColor=b6e3f4',
    category: 'adventurer',
  },
  {
    id: 'adv-2',
    name: 'Jordan',
    url: 'https://api.dicebear.com/7.x/adventurer/svg?seed=Jordan&backgroundColor=c0aede',
    category: 'adventurer',
  },
  {
    id: 'adv-3',
    name: 'Taylor',
    url: 'https://api.dicebear.com/7.x/adventurer/svg?seed=Taylor&backgroundColor=ffd5dc',
    category: 'adventurer',
  },
  {
    id: 'adv-4',
    name: 'Morgan',
    url: 'https://api.dicebear.com/7.x/adventurer/svg?seed=Morgan&backgroundColor=d1d4f9',
    category: 'adventurer',
  },
  {
    id: 'adv-5',
    name: 'Casey',
    url: 'https://api.dicebear.com/7.x/adventurer/svg?seed=Casey&backgroundColor=ffdfbf',
    category: 'adventurer',
  },
  {
    id: 'adv-6',
    name: 'Riley',
    url: 'https://api.dicebear.com/7.x/adventurer/svg?seed=Riley&backgroundColor=b8e6c4',
    category: 'adventurer',
  },
  
  // Lorelei style - elegant illustrated characters
  {
    id: 'lor-1',
    name: 'Sophie',
    url: 'https://api.dicebear.com/7.x/lorelei/svg?seed=Sophie&backgroundColor=ffd5dc',
    category: 'lorelei',
  },
  {
    id: 'lor-2',
    name: 'Marcus',
    url: 'https://api.dicebear.com/7.x/lorelei/svg?seed=Marcus&backgroundColor=b6e3f4',
    category: 'lorelei',
  },
  {
    id: 'lor-3',
    name: 'Emma',
    url: 'https://api.dicebear.com/7.x/lorelei/svg?seed=Emma&backgroundColor=c0aede',
    category: 'lorelei',
  },
  {
    id: 'lor-4',
    name: 'David',
    url: 'https://api.dicebear.com/7.x/lorelei/svg?seed=David&backgroundColor=d1d4f9',
    category: 'lorelei',
  },
  {
    id: 'lor-5',
    name: 'Lily',
    url: 'https://api.dicebear.com/7.x/lorelei/svg?seed=Lily&backgroundColor=ffdfbf',
    category: 'lorelei',
  },
  {
    id: 'lor-6',
    name: 'James',
    url: 'https://api.dicebear.com/7.x/lorelei/svg?seed=James&backgroundColor=b8e6c4',
    category: 'lorelei',
  },
  
  // Notionists style - minimalist cartoon style
  {
    id: 'not-1',
    name: 'Sam',
    url: 'https://api.dicebear.com/7.x/notionists/svg?seed=Sam&backgroundColor=b6e3f4',
    category: 'notionists',
  },
  {
    id: 'not-2',
    name: 'Jamie',
    url: 'https://api.dicebear.com/7.x/notionists/svg?seed=Jamie&backgroundColor=c0aede',
    category: 'notionists',
  },
  {
    id: 'not-3',
    name: 'Chris',
    url: 'https://api.dicebear.com/7.x/notionists/svg?seed=Chris&backgroundColor=ffd5dc',
    category: 'notionists',
  },
  {
    id: 'not-4',
    name: 'Pat',
    url: 'https://api.dicebear.com/7.x/notionists/svg?seed=Pat&backgroundColor=d1d4f9',
    category: 'notionists',
  },
  {
    id: 'not-5',
    name: 'Drew',
    url: 'https://api.dicebear.com/7.x/notionists/svg?seed=Drew&backgroundColor=ffdfbf',
    category: 'notionists',
  },
  {
    id: 'not-6',
    name: 'Quinn',
    url: 'https://api.dicebear.com/7.x/notionists/svg?seed=Quinn&backgroundColor=b8e6c4',
    category: 'notionists',
  },
  
  // Fun Emoji style avatars
  {
    id: 'fun-1',
    name: 'Pixel Hero',
    url: 'https://api.dicebear.com/7.x/pixel-art/svg?seed=hero&backgroundColor=b6e3f4',
    category: 'fun',
  },
  {
    id: 'fun-2',
    name: 'Thumbs Up',
    url: 'https://api.dicebear.com/7.x/thumbs/svg?seed=thumbs&backgroundColor=ffdfbf',
    category: 'fun',
  },
  {
    id: 'fun-3',
    name: 'Big Ears',
    url: 'https://api.dicebear.com/7.x/big-ears/svg?seed=ears&backgroundColor=ffd5dc',
    category: 'fun',
  },
  {
    id: 'fun-4',
    name: 'Fun Face',
    url: 'https://api.dicebear.com/7.x/fun-emoji/svg?seed=face&backgroundColor=c0aede',
    category: 'fun',
  },
  {
    id: 'fun-5',
    name: 'Croodles',
    url: 'https://api.dicebear.com/7.x/croodles/svg?seed=doodle&backgroundColor=b8e6c4',
    category: 'fun',
  },
  {
    id: 'fun-6',
    name: 'Micah',
    url: 'https://api.dicebear.com/7.x/micah/svg?seed=micah&backgroundColor=d1d4f9',
    category: 'fun',
  },
];

// Category labels for display
export const AVATAR_CATEGORIES = {
  adventurer: { label: 'Adventurer', description: 'Friendly illustrated characters' },
  lorelei: { label: 'Elegant', description: 'Sophisticated character portraits' },
  notionists: { label: 'Minimalist', description: 'Clean, simple cartoon style' },
  fun: { label: 'Fun & Playful', description: 'Unique and quirky styles' },
} as const;

// Legacy export for backwards compatibility
export const DEFAULT_AVATARS = [
  {
    id: 'initials',
    name: 'Initials',
    url: null,
    category: 'initials' as const,
  },
  ...CARTOON_AVATARS.slice(0, 8), // First 8 for quick access
];

// Generate a random avatar with a specific style
export function generateRandomAvatar(seed: string, style: 'adventurer' | 'lorelei' | 'notionists' | 'fun-emoji' = 'adventurer'): string {
  const backgrounds = ['b6e3f4', 'c0aede', 'd1d4f9', 'ffd5dc', 'ffdfbf', 'b8e6c4'];
  const randomBg = backgrounds[Math.floor(Math.random() * backgrounds.length)];
  return `https://api.dicebear.com/7.x/${style}/svg?seed=${encodeURIComponent(seed)}&backgroundColor=${randomBg}`;
}

// Get avatars by category
export function getAvatarsByCategory(category: keyof typeof AVATAR_CATEGORIES): AvatarOption[] {
  return CARTOON_AVATARS.filter(avatar => avatar.category === category);
}

// Get all cartoon avatars
export function getAllCartoonAvatars(): AvatarOption[] {
  return CARTOON_AVATARS;
}
