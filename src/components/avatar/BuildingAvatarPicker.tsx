/**
 * Building-specific avatar picker with geometric patterns
 */

import { useState } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  getBuildingAvatars,
  AVATAR_BACKGROUNDS,
  generateCustomAvatar,
  AvatarOption,
} from '@/lib/avatars';
import { Check, Shuffle, Building2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BuildingAvatarPickerProps {
  selectedUrl: string | null;
  onSelect: (url: string | null) => void;
  buildingName?: string;
  disabled?: boolean;
}

export function BuildingAvatarPicker({
  selectedUrl,
  onSelect,
  buildingName = 'Building',
  disabled = false,
}: BuildingAvatarPickerProps) {
  const buildingAvatars = getBuildingAvatars();
  
  // Generate initials from building name
  const initials = buildingName
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase() || 'B';

  const handleGenerateRandom = () => {
    const styles = ['identicon', 'shapes', 'rings'] as const;
    const randomStyle = styles[Math.floor(Math.random() * styles.length)];
    const randomBg = AVATAR_BACKGROUNDS[Math.floor(Math.random() * (AVATAR_BACKGROUNDS.length - 1))].value;
    const randomSeed = buildingName + Math.random().toString(36).substring(2, 6);
    const url = `https://api.dicebear.com/7.x/${randomStyle}/svg?seed=${encodeURIComponent(randomSeed)}&backgroundColor=${randomBg}`;
    onSelect(url);
  };

  const handleGenerateFromName = () => {
    const randomBg = AVATAR_BACKGROUNDS[Math.floor(Math.random() * (AVATAR_BACKGROUNDS.length - 1))].value;
    const url = `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(buildingName)}&backgroundColor=${randomBg}`;
    onSelect(url);
  };

  return (
    <div className="space-y-4">
      {/* Quick Actions */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={handleGenerateRandom}
          disabled={disabled}
        >
          <Shuffle className="h-4 w-4 mr-2" />
          Random Pattern
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleGenerateFromName}
          disabled={disabled}
        >
          <Building2 className="h-4 w-4 mr-2" />
          From Name
        </Button>
      </div>

      {/* Avatar Grid */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">Choose a Pattern</Label>
        <p className="text-xs text-muted-foreground mb-3">
          Geometric patterns perfect for building identities
        </p>
        <ScrollArea className="h-40">
          <div className="grid grid-cols-6 gap-2">
            {buildingAvatars.map((avatar) => {
              const isSelected = avatar.url === selectedUrl;
              return (
                <button
                  key={avatar.id}
                  onClick={() => onSelect(avatar.url)}
                  disabled={disabled}
                  className={cn(
                    'relative rounded-lg p-1 transition-all hover:scale-105',
                    isSelected
                      ? 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                      : 'hover:ring-2 hover:ring-muted-foreground/30'
                  )}
                  title={avatar.name}
                >
                  <Avatar className="h-10 w-10 rounded-lg">
                    <AvatarImage src={avatar.url || undefined} alt={avatar.name} className="rounded-lg" />
                    <AvatarFallback className="bg-muted text-muted-foreground text-xs rounded-lg">
                      {avatar.name.slice(0, 2)}
                    </AvatarFallback>
                  </Avatar>
                  {isSelected && (
                    <div className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-primary flex items-center justify-center">
                      <Check className="h-2.5 w-2.5 text-primary-foreground" />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </div>

      {/* Use Initials Option */}
      <div className="flex items-center gap-3 pt-2 border-t">
        <button
          onClick={() => onSelect(null)}
          disabled={disabled}
          className={cn(
            'flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors',
            !selectedUrl
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-muted hover:border-muted-foreground/50'
          )}
        >
          <div className="h-8 w-8 rounded-lg bg-primary/20 text-primary flex items-center justify-center text-sm font-semibold">
            {initials}
          </div>
          <span className="text-sm">Use initials</span>
          {!selectedUrl && <Check className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
