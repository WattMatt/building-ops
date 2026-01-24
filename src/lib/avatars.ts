// Default avatar options using DiceBear API
export const DEFAULT_AVATARS = [
  {
    id: 'initials',
    name: 'Initials',
    url: null, // Will use initials fallback
  },
  {
    id: 'avatar-1',
    name: 'Professional',
    url: 'https://api.dicebear.com/7.x/personas/svg?seed=professional&backgroundColor=b6e3f4',
  },
  {
    id: 'avatar-2',
    name: 'Friendly',
    url: 'https://api.dicebear.com/7.x/personas/svg?seed=friendly&backgroundColor=c0aede',
  },
  {
    id: 'avatar-3',
    name: 'Creative',
    url: 'https://api.dicebear.com/7.x/personas/svg?seed=creative&backgroundColor=d1d4f9',
  },
  {
    id: 'avatar-4',
    name: 'Abstract Blue',
    url: 'https://api.dicebear.com/7.x/shapes/svg?seed=blue&backgroundColor=b6e3f4',
  },
  {
    id: 'avatar-5',
    name: 'Abstract Purple',
    url: 'https://api.dicebear.com/7.x/shapes/svg?seed=purple&backgroundColor=c0aede',
  },
  {
    id: 'avatar-6',
    name: 'Abstract Green',
    url: 'https://api.dicebear.com/7.x/shapes/svg?seed=green&backgroundColor=b8e6c4',
  },
  {
    id: 'avatar-7',
    name: 'Bot Blue',
    url: 'https://api.dicebear.com/7.x/bottts/svg?seed=bot1&backgroundColor=b6e3f4',
  },
  {
    id: 'avatar-8',
    name: 'Bot Orange',
    url: 'https://api.dicebear.com/7.x/bottts/svg?seed=bot2&backgroundColor=ffd5b4',
  },
];

export function generateRandomAvatar(seed: string): string {
  return `https://api.dicebear.com/7.x/personas/svg?seed=${encodeURIComponent(seed)}&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5b4,b8e6c4`;
}
