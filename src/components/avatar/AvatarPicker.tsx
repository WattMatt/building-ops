/**
 * Reusable avatar picker component with category tabs and customization
 */

import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  CARTOON_AVATARS, 
  AVATAR_CATEGORIES, 
  AVATAR_BACKGROUNDS,
  AVATAR_STYLES,
  generateCustomAvatar,
  AvatarStyle,
  AvatarOption,
} from '@/lib/avatars';
import { Check, Shuffle, Palette } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

interface AvatarPickerProps {
  selectedUrl: string | null;
  onSelect: (url: string | null) => void;
  userInitials?: string;
  disabled?: boolean;
  showInitialsOption?: boolean;
  categories?: Array<keyof typeof AVATAR_CATEGORIES>;
  showCustomization?: boolean;
}

export function AvatarPicker({
  selectedUrl,
  onSelect,
  userInitials = 'U',
  disabled = false,
  showInitialsOption = true,
  categories = Object.keys(AVATAR_CATEGORIES) as Array<keyof typeof AVATAR_CATEGORIES>,
  showCustomization = true,
}: AvatarPickerProps) {
  const [customSeed, setCustomSeed] = useState('');
  const [customStyle, setCustomStyle] = useState<AvatarStyle>('adventurer');
  const [customBg, setCustomBg] = useState('b6e3f4');

  const handleGenerateRandom = () => {
    const randomStyle = AVATAR_STYLES[Math.floor(Math.random() * AVATAR_STYLES.length)].id;
    const randomBg = AVATAR_BACKGROUNDS[Math.floor(Math.random() * (AVATAR_BACKGROUNDS.length - 1))].value;
    const randomSeed = Math.random().toString(36).substring(2, 10);
    const url = generateCustomAvatar({ seed: randomSeed, style: randomStyle, backgroundColor: randomBg });
    onSelect(url);
  };

  const handleGenerateCustom = () => {
    const seed = customSeed || Math.random().toString(36).substring(2, 10);
    const url = generateCustomAvatar({ seed, style: customStyle, backgroundColor: customBg });
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
          Random
        </Button>

        {showCustomization && (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" disabled={disabled}>
                <Palette className="h-4 w-4 mr-2" />
                Customize
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80" align="start">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-xs">Avatar Style</Label>
                  <div className="grid grid-cols-2 gap-1">
                    {AVATAR_STYLES.slice(0, 6).map((style) => (
                      <button
                        key={style.id}
                        onClick={() => setCustomStyle(style.id)}
                        className={cn(
                          'px-2 py-1.5 text-xs rounded-md border transition-colors',
                          customStyle === style.id
                            ? 'border-primary bg-primary/10'
                            : 'border-muted hover:border-muted-foreground/50'
                        )}
                      >
                        {style.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs">Background Color</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {AVATAR_BACKGROUNDS.map((bg) => (
                      <button
                        key={bg.id}
                        onClick={() => setCustomBg(bg.value)}
                        className={cn(
                          'w-6 h-6 rounded-full border-2 transition-all',
                          customBg === bg.value
                            ? 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                            : 'hover:scale-110'
                        )}
                        style={{ 
                          backgroundColor: bg.value === 'transparent' ? 'transparent' : `#${bg.value}`,
                          borderColor: bg.value === 'transparent' ? 'hsl(var(--border))' : `#${bg.value}`,
                        }}
                        title={bg.name}
                      />
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs">Custom Seed (optional)</Label>
                  <input
                    type="text"
                    value={customSeed}
                    onChange={(e) => setCustomSeed(e.target.value)}
                    placeholder="Enter a name or word..."
                    className="w-full px-3 py-1.5 text-sm rounded-md border bg-background"
                  />
                </div>

                <Button size="sm" className="w-full" onClick={handleGenerateCustom}>
                  Generate Avatar
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>

      {/* Category Tabs */}
      <Tabs defaultValue={categories[0]} className="w-full">
        <TabsList className="flex flex-wrap h-auto gap-1 p-1">
          {categories.map((category) => (
            <TabsTrigger
              key={category}
              value={category}
              className="text-xs py-1.5 px-2"
            >
              {AVATAR_CATEGORIES[category].label}
            </TabsTrigger>
          ))}
        </TabsList>

        {categories.map((category) => (
          <TabsContent key={category} value={category} className="mt-3">
            <p className="text-xs text-muted-foreground mb-3">
              {AVATAR_CATEGORIES[category].description}
            </p>
            <ScrollArea className="h-32">
              <div className="grid grid-cols-6 gap-2">
                {CARTOON_AVATARS.filter((a) => a.category === category).map((avatar) => {
                  const isSelected = avatar.url === selectedUrl;
                  return (
                    <AvatarButton
                      key={avatar.id}
                      avatar={avatar}
                      isSelected={isSelected}
                      onClick={() => onSelect(avatar.url)}
                      disabled={disabled}
                    />
                  );
                })}
              </div>
            </ScrollArea>
          </TabsContent>
        ))}
      </Tabs>

      {/* Use Initials Option */}
      {showInitialsOption && (
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
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-muted text-muted-foreground text-sm">
                {userInitials}
              </AvatarFallback>
            </Avatar>
            <span className="text-sm">Use initials</span>
            {!selectedUrl && <Check className="h-4 w-4" />}
          </button>
        </div>
      )}
    </div>
  );
}

interface AvatarButtonProps {
  avatar: AvatarOption;
  isSelected: boolean;
  onClick: () => void;
  disabled?: boolean;
}

function AvatarButton({ avatar, isSelected, onClick, disabled }: AvatarButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'relative rounded-lg p-1 transition-all hover:scale-105',
        isSelected
          ? 'ring-2 ring-primary ring-offset-2 ring-offset-background'
          : 'hover:ring-2 hover:ring-muted-foreground/30'
      )}
      title={avatar.name}
    >
      <Avatar className="h-10 w-10">
        <AvatarImage src={avatar.url || undefined} alt={avatar.name} />
        <AvatarFallback className="bg-muted text-muted-foreground text-xs">
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
}
