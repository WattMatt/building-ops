/**
 * Live preview of building card showing logo position
 */

import { MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';
import { BuildingAvatar } from './BuildingAvatar';

interface BuildingCardPreviewProps {
  name: string;
  address: string;
  logoUrl: string | null;
  logoPosition: string;
  avatarColor?: string | null;
}

export function BuildingCardPreview({
  name,
  address,
  logoUrl,
  logoPosition,
  avatarColor,
}: BuildingCardPreviewProps) {
  const displayName = name.trim() || 'Building Name';
  const displayAddress = address.trim() || '123 Example Street, City';

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-muted-foreground">Card Preview</p>
      <div className="relative overflow-hidden rounded-xl border bg-card shadow-sm max-w-xs">
        {/* Logo positioned absolutely based on logoPosition */}
        {logoUrl && (
          <div
            className={cn(
              'absolute z-10 p-2',
              logoPosition === 'top-left' && 'top-0 left-0',
              logoPosition === 'top-center' && 'top-0 left-1/2 -translate-x-1/2',
              logoPosition === 'top-right' && 'top-0 right-0'
            )}
          >
            <img
              src={logoUrl}
              alt="Logo preview"
              className="w-10 h-10 object-contain rounded-md bg-background/90 backdrop-blur-sm border shadow-sm"
            />
          </div>
        )}

        {/* Card Content */}
        <div className="p-4 pt-14">
          <div className="flex items-start gap-3">
            <BuildingAvatar name={displayName} logoUrl={logoUrl} avatarColor={avatarColor} size="md" />
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-sm truncate">{displayName}</h3>
              <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                <MapPin className="h-3 w-3 shrink-0" />
                <span className="truncate">{displayAddress}</span>
              </div>
            </div>
          </div>
          
          {/* Mock stats row */}
          <div className="mt-3 pt-3 border-t flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-success" />
              3 Tasks
            </span>
            <span className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-warning" />
              1 Issue
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
