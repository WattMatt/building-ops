import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MapPin, Building2, Layers, Navigation, AlertCircle } from 'lucide-react';
import { BuildingMap, BuildingMarker } from '@/components/map/BuildingMap';
import { MapSearchBox } from '@/components/map/MapSearchBox';
import { MAP_STYLES, MapStyle } from '@/lib/mapbox';

export default function MapView() {
  const navigate = useNavigate();
  const [mapStyle, setMapStyle] = useState<MapStyle>('streets');
  const [selectedBuildingId, setSelectedBuildingId] = useState<string | null>(null);

  // Fetch buildings with coordinates
  const { data: buildings, isLoading, error } = useQuery({
    queryKey: ['buildings-map'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('buildings')
        .select('id, name, address, city, latitude, longitude, logo_url')
        .order('name');

      if (error) throw error;
      return data as BuildingMarker[];
    },
  });

  const buildingsWithCoords = buildings?.filter((b) => b.latitude && b.longitude) || [];
  const buildingsWithoutCoords = buildings?.filter((b) => !b.latitude || !b.longitude) || [];

  const handleBuildingClick = useCallback((buildingId: string) => {
    navigate(`/buildings/${buildingId}`);
  }, [navigate]);

  const handleLocationSelect = useCallback((location: { lng: number; lat: number; name: string }) => {
    // Find buildings near this location (within ~1km)
    const nearbyBuilding = buildingsWithCoords.find((b) => {
      const distance = Math.sqrt(
        Math.pow((b.longitude - location.lng) * 111, 2) +
        Math.pow((b.latitude - location.lat) * 111, 2)
      );
      return distance < 1; // Within 1km
    });

    if (nearbyBuilding) {
      setSelectedBuildingId(nearbyBuilding.id);
    }
  }, [buildingsWithCoords]);

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Map View</h1>
          <p className="text-muted-foreground">View your buildings on a map</p>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <AlertCircle className="h-12 w-12 text-destructive mb-4" />
            <p className="text-destructive">Failed to load buildings</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Map View</h1>
          <p className="text-muted-foreground">
            View your buildings on an interactive map
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          {/* Search box */}
          <MapSearchBox
            onLocationSelect={handleLocationSelect}
            className="w-full sm:w-80"
          />

          {/* Map style selector */}
          <Select value={mapStyle} onValueChange={(v) => setMapStyle(v as MapStyle)}>
            <SelectTrigger className="w-40">
              <Layers className="h-4 w-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="streets">Streets</SelectItem>
              <SelectItem value="satellite">Satellite</SelectItem>
              <SelectItem value="light">Light</SelectItem>
              <SelectItem value="dark">Dark</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Stats bar */}
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <Badge variant="secondary" className="gap-1.5">
          <Building2 className="h-3.5 w-3.5" />
          {isLoading ? '...' : `${buildingsWithCoords.length} buildings mapped`}
        </Badge>
        {buildingsWithoutCoords.length > 0 && (
          <Badge variant="outline" className="gap-1.5 text-muted-foreground">
            <MapPin className="h-3.5 w-3.5" />
            {buildingsWithoutCoords.length} without coordinates
          </Badge>
        )}
      </div>

      {/* Map */}
      <Card className="overflow-hidden">
        {isLoading ? (
          <Skeleton className="h-[600px] w-full" />
        ) : buildingsWithCoords.length === 0 ? (
          <CardContent className="flex flex-col items-center justify-center py-24">
            <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center mb-6">
              <MapPin className="h-10 w-10 text-muted-foreground" />
            </div>
            <h3 className="text-xl font-semibold mb-2">No Buildings with Coordinates</h3>
            <p className="text-muted-foreground text-center max-w-md mb-6">
              Add latitude and longitude coordinates to your buildings to see them on the map.
            </p>
            <Button onClick={() => navigate('/buildings')}>
              <Building2 className="h-4 w-4 mr-2" />
              Manage Buildings
            </Button>
          </CardContent>
        ) : (
          <BuildingMap
            buildings={buildingsWithCoords}
            onBuildingClick={handleBuildingClick}
            selectedBuildingId={selectedBuildingId}
            mapStyle={mapStyle}
            className="h-[600px]"
          />
        )}
      </Card>

      {/* Buildings without coordinates warning */}
      {buildingsWithoutCoords.length > 0 && (
        <Card className="border-warning/50 bg-warning/5">
          <CardContent className="py-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-warning shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-sm">
                  {buildingsWithoutCoords.length} building{buildingsWithoutCoords.length > 1 ? 's' : ''} missing coordinates
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  The following buildings don't appear on the map:{' '}
                  {buildingsWithoutCoords.map((b) => b.name).join(', ')}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
