/**
 * Building-specific avatar picker with geometric patterns and color customization
 */

import { useState } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  getBuildingAvatars,
  AVATAR_BACKGROUNDS,
  AvatarOption,
} from '@/lib/avatars';
import { AVATAR_COLORS } from '@/components/building/BuildingAvatar';
import { Check, Shuffle, Building2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BuildingAvatarPickerProps {
  selectedUrl: string | null;
  selectedColor: string | null;
  onSelect: (url: string | null) => void;
  onColorChange: (color: string | null) => void;
  buildingName?: string;
  disabled?: boolean;
}

export function BuildingAvatarPicker({
  selectedUrl,
  selectedColor,
  onSelect,
  onColorChange,
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

  const handleUseInitials = () => {
    onSelect(null);
  };

  // Get current color for preview
  const currentColor = selectedColor || AVATAR_COLORS[0].hex;
  const previewColor = AVATAR_COLORS.find(c => c.hex === selectedColor)?.hex || '#3b82f6';

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

      {/* Use Initials Option with Color Picker */}
      <div className="space-y-3 pt-2 border-t">
        <div className="flex items-center gap-3">
          <button
            onClick={handleUseInitials}
            disabled={disabled}
            className={cn(
              'flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors',
              !selectedUrl
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-muted hover:border-muted-foreground/50'
            )}
          >
            <div 
              className="h-8 w-8 rounded-lg flex items-center justify-center text-sm font-semibold text-white"
              style={{ backgroundColor: previewColor }}
            >
              {initials}
            </div>
            <span className="text-sm">Use initials</span>
            {!selectedUrl && <Check className="h-4 w-4" />}
          </button>
        </div>

        {/* Color Picker - Only show when using initials */}
        {!selectedUrl && (
          <div className="space-y-2">
            <Label className="text-sm font-medium">Avatar Color</Label>
            <div className="flex flex-wrap gap-2">
              {AVATAR_COLORS.map((color) => {
                const isSelected = selectedColor === color.hex;
                return (
                  <button
                    key={color.hex}
                    onClick={() => onColorChange(color.hex)}
                    disabled={disabled}
                    className={cn(
                      'w-8 h-8 rounded-full transition-all hover:scale-110',
                      isSelected && 'ring-2 ring-offset-2 ring-offset-background ring-primary'
                    )}
                    style={{ backgroundColor: color.hex }}
                    title={color.name}
                  >
                    {isSelected && (
                      <Check className="h-4 w-4 text-white mx-auto" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
