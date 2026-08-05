/**
 * Building-specific avatar picker with geometric patterns and color customization
 */

import { useMemo } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  getBuildingAvatars,
} from '@/lib/avatars';
import { AVATAR_COLORS } from '@/components/building/BuildingAvatar';
import { Check, Shuffle, Building2, Palette } from 'lucide-react';
import { cn } from '@/lib/utils';

// Pattern background colors (hex format for DiceBear URLs)
const PATTERN_BACKGROUNDS = [
  { name: 'Sky Blue', value: 'b6e3f4', hex: '#b6e3f4' },
  { name: 'Lavender', value: 'c0aede', hex: '#c0aede' },
  { name: 'Rose', value: 'ffd5dc', hex: '#ffd5dc' },
  { name: 'Periwinkle', value: 'd1d4f9', hex: '#d1d4f9' },
  { name: 'Peach', value: 'ffdfbf', hex: '#ffdfbf' },
  { name: 'Mint', value: 'b8e6c4', hex: '#b8e6c4' },
  { name: 'Coral', value: 'ffb5a7', hex: '#ffb5a7' },
  { name: 'Lemon', value: 'fef3c7', hex: '#fef3c7' },
  { name: 'Slate', value: 'cbd5e1', hex: '#cbd5e1' },
  { name: 'White', value: 'ffffff', hex: '#ffffff' },
];

interface BuildingAvatarPickerProps {
  selectedUrl: string | null;
  selectedColor: string | null;
  onSelect: (url: string | null) => void;
  onColorChange: (color: string | null) => void;
  buildingName?: string;
  disabled?: boolean;
}

// Helper to update background color in a DiceBear URL
function updatePatternBackground(url: string, bgColor: string): string {
  try {
    const urlObj = new URL(url);
    urlObj.searchParams.set('backgroundColor', bgColor);
    return urlObj.toString();
  } catch {
    return url;
  }
}

// Helper to extract background color from a DiceBear URL
function getPatternBackground(url: string): string | null {
  try {
    const urlObj = new URL(url);
    return urlObj.searchParams.get('backgroundColor');
  } catch {
    return null;
  }
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

  // Get current pattern background color
  const currentPatternBg = useMemo(() => {
    if (selectedUrl?.includes('dicebear')) {
      return getPatternBackground(selectedUrl);
    }
    return null;
  }, [selectedUrl]);

  const handleGenerateRandom = () => {
    const styles = ['identicon', 'shapes', 'rings'] as const;
    const randomStyle = styles[Math.floor(Math.random() * styles.length)];
    const randomBg = PATTERN_BACKGROUNDS[Math.floor(Math.random() * PATTERN_BACKGROUNDS.length)].value;
    const randomSeed = buildingName + Math.random().toString(36).substring(2, 6);
    const url = `https://api.dicebear.com/7.x/${randomStyle}/svg?seed=${encodeURIComponent(randomSeed)}&backgroundColor=${randomBg}`;
    onSelect(url);
  };

  const handleGenerateFromName = () => {
    const randomBg = PATTERN_BACKGROUNDS[Math.floor(Math.random() * PATTERN_BACKGROUNDS.length)].value;
    const url = `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(buildingName)}&backgroundColor=${randomBg}`;
    onSelect(url);
  };

  const handleUseInitials = () => {
    onSelect(null);
  };

  const handlePatternBackgroundChange = (bgValue: string) => {
    if (selectedUrl?.includes('dicebear')) {
      const updatedUrl = updatePatternBackground(selectedUrl, bgValue);
      onSelect(updatedUrl);
    }
  };

  // Get current color for preview
  const previewColor = AVATAR_COLORS.find(c => c.hex === selectedColor)?.hex || '#3b82f6';

  // Check if a pattern is currently selected
  const isPatternSelected = selectedUrl?.includes('dicebear');

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
              // Check if this pattern is selected (match by seed, ignoring background)
              const avatarSeed = avatar.url ? new URL(avatar.url).searchParams.get('seed') : null;
              const selectedSeed = selectedUrl?.includes('dicebear') 
                ? new URL(selectedUrl).searchParams.get('seed') 
                : null;
              const isSelected = avatarSeed && selectedSeed && avatarSeed === selectedSeed;
              
              return (
                <button
                  key={avatar.id}
                  onClick={() => {
                    // Apply current background color to new pattern if one is selected
                    if (avatar.url && currentPatternBg) {
                      onSelect(updatePatternBackground(avatar.url, currentPatternBg));
                    } else {
                      onSelect(avatar.url);
                    }
                  }}
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
                    <AvatarImage 
                      src={currentPatternBg && avatar.url 
                        ? updatePatternBackground(avatar.url, currentPatternBg) 
                        : avatar.url || undefined
                      } 
                      alt={avatar.name} 
                      className="rounded-lg" 
                    />
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

      {/* Pattern Background Color Picker - Show when pattern is selected */}
      {isPatternSelected && (
        <div className="space-y-2 pt-2 border-t">
          <div className="flex items-center gap-2">
            <Palette className="h-4 w-4 text-muted-foreground" />
            <Label className="text-sm font-medium">Pattern Background</Label>
          </div>
          <div className="flex flex-wrap gap-2">
            {PATTERN_BACKGROUNDS.map((bg) => {
              const isSelected = currentPatternBg === bg.value;
              return (
                <button
                  key={bg.value}
                  onClick={() => handlePatternBackgroundChange(bg.value)}
                  disabled={disabled}
                  className={cn(
                    'w-7 h-7 rounded-full transition-all hover:scale-110 border border-border',
                    isSelected && 'ring-2 ring-offset-2 ring-offset-background ring-primary'
                  )}
                  style={{ backgroundColor: bg.hex }}
                  title={bg.name}
                >
                  {isSelected && (
                    <Check className="h-3.5 w-3.5 text-foreground/70 mx-auto" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

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
