import { useMemo, useState } from 'react';
import { MapPin, Crosshair, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MapSearchBox } from '@/components/map/MapSearchBox';
import { BuildingMap, BuildingMarker } from '@/components/map/BuildingMap';
import { MAPBOX_ACCESS_TOKEN } from '@/lib/mapbox';

interface LocationSectionProps {
  address: string;
  latitude: number | null;
  longitude: number | null;
  onChange: (coords: { latitude: number; longitude: number } | null) => void;
}

export default function LocationSection({ address, latitude, longitude, onChange }: LocationSectionProps) {
  const [geocoding, setGeocoding] = useState(false);

  // Single marker for the confirmation map. Memoized so the map only re-fits
  // when the coordinates or label actually change.
  const markers = useMemo<BuildingMarker[]>(() => {
    if (latitude == null || longitude == null) return [];
    return [
      {
        id: 'building-location',
        name: address.trim() || 'Building location',
        address: address.trim(),
        city: '',
        latitude,
        longitude,
      },
    ];
  }, [latitude, longitude, address]);

  // Forward-geocode the typed address on demand (ZA, biased to Pretoria),
  // mirroring MapSearchBox but taking the single best match.
  const geocodeAddress = async () => {
    const query = address.trim();
    if (!query) {
      toast.error('Enter an address first');
      return;
    }

    setGeocoding(true);
    try {
      const response = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?` +
          new URLSearchParams({
            access_token: MAPBOX_ACCESS_TOKEN,
            country: 'ZA',
            proximity: '28.1881,-25.7461', // Pretoria
            types: 'address,poi,place,locality,neighborhood',
            limit: '1',
          })
      );

      if (!response.ok) throw new Error('Geocoding request failed');

      const data = await response.json();
      const feature = data.features?.[0];
      if (!feature) {
        toast.error('Could not find that address — try the search box');
        return;
      }

      const [lng, lat] = feature.center as [number, number];
      onChange({ latitude: lat, longitude: lng });
      toast.success('Location set from address');
    } catch (error) {
      if (import.meta.env.DEV) console.error('Geocode error:', error);
      toast.error('Could not look up that address');
    } finally {
      setGeocoding(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MapPin className="h-5 w-5" />
          Location
        </CardTitle>
        <CardDescription>
          Set the building's position so it appears on the map. Search for a place or use the address above.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col sm:flex-row gap-2">
          <MapSearchBox
            className="flex-1"
            placeholder="Search for the building location..."
            onLocationSelect={({ lng, lat }) => onChange({ latitude: lat, longitude: lng })}
          />
          <Button
            type="button"
            variant="outline"
            onClick={geocodeAddress}
            disabled={geocoding || !address.trim()}
            className="shrink-0"
          >
            {geocoding ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Crosshair className="h-4 w-4 mr-2" />
            )}
            Use typed address
          </Button>
        </div>

        {latitude != null && longitude != null ? (
          <div className="space-y-2">
            <BuildingMap
              buildings={markers}
              mapStyle="streets"
              pinDropMode
              onPinDrop={({ lng, lat }) => onChange({ latitude: lat, longitude: lng })}
              className="h-60 min-h-[240px]"
            />
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 shrink-0" />
                Pinned at {latitude.toFixed(5)}, {longitude.toFixed(5)} — click the map to adjust
              </p>
              <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
                <X className="h-3.5 w-3.5 mr-1" />
                Clear
              </Button>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No location set. Buildings without a location show &ldquo;No location&rdquo; and won&rsquo;t appear on the map.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
