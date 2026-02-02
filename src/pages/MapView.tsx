import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { MapPin, Building2, Layers, AlertCircle, X, Check, MousePointer } from 'lucide-react';
import { BuildingMap, BuildingMarker } from '@/components/map/BuildingMap';
import { MapSearchBox } from '@/components/map/MapSearchBox';
import { MAP_STYLES, MapStyle } from '@/lib/mapbox';
import { toast } from 'sonner';

export default function MapView() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [mapStyle, setMapStyle] = useState<MapStyle>('satellite');
  const [selectedBuildingId, setSelectedBuildingId] = useState<string | null>(null);
  const [flyToLocation, setFlyToLocation] = useState<{ lng: number; lat: number } | null>(null);
  
  // Pin drop mode state
  const [pinDropMode, setPinDropMode] = useState(false);
  const [buildingToPin, setBuildingToPin] = useState<{ id: string; name: string } | null>(null);
  const [droppedCoords, setDroppedCoords] = useState<{ lng: number; lat: number } | null>(null);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);

  // Fetch buildings with coordinates and stats
  const { data: buildings, isLoading, error } = useQuery({
    queryKey: ['buildings-map'],
    queryFn: async () => {
      // Fetch buildings
      const { data: buildingsData, error: buildingsError } = await supabase
        .from('buildings')
        .select('id, name, address, city, latitude, longitude, logo_url, logo_position, avatar_color')
        .order('name');

      if (buildingsError) throw buildingsError;

      // Fetch task counts per building (pending tasks only)
      const { data: taskCounts } = await supabase
        .from('task_instances')
        .select('building_id')
        .eq('status', 'pending');

      // Fetch issue counts per building (non-resolved issues)
      const { data: issueCounts } = await supabase
        .from('issues')
        .select('building_id')
        .neq('status', 'resolved');

      // Aggregate counts
      const taskCountMap = new Map<string, number>();
      const issueCountMap = new Map<string, number>();

      taskCounts?.forEach((t) => {
        taskCountMap.set(t.building_id, (taskCountMap.get(t.building_id) || 0) + 1);
      });

      issueCounts?.forEach((i) => {
        issueCountMap.set(i.building_id, (issueCountMap.get(i.building_id) || 0) + 1);
      });

      return buildingsData.map((b) => ({
        id: b.id,
        name: b.name,
        address: b.address,
        city: b.city,
        latitude: b.latitude!,
        longitude: b.longitude!,
        logoUrl: b.logo_url,
        logoPosition: b.logo_position,
        avatarColor: b.avatar_color,
        taskCount: taskCountMap.get(b.id) || 0,
        issueCount: issueCountMap.get(b.id) || 0,
      })) as BuildingMarker[];
    },
  });

  // Mutation to update building coordinates
  const updateCoordsMutation = useMutation({
    mutationFn: async ({ buildingId, lat, lng }: { buildingId: string; lat: number; lng: number }) => {
      const { error } = await supabase
        .from('buildings')
        .update({ latitude: lat, longitude: lng })
        .eq('id', buildingId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['buildings-map'] });
      toast.success(`Location set for ${buildingToPin?.name}`);
      cancelPinDropMode();
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to update building location');
    },
  });

  const buildingsWithCoords = buildings?.filter((b) => b.latitude && b.longitude) || [];
  const buildingsWithoutCoords = buildings?.filter((b) => !b.latitude || !b.longitude) || [];

  const handleBuildingClick = useCallback((buildingId: string) => {
    navigate(`/buildings/${buildingId}`);
  }, [navigate]);

  const handleLocationSelect = useCallback((location: { lng: number; lat: number; name: string }) => {
    setFlyToLocation({ lng: location.lng, lat: location.lat });
    
    const nearbyBuilding = buildingsWithCoords.find((b) => {
      const distance = Math.sqrt(
        Math.pow((b.longitude - location.lng) * 111, 2) +
        Math.pow((b.latitude - location.lat) * 111, 2)
      );
      return distance < 1;
    });

    if (nearbyBuilding) {
      setSelectedBuildingId(nearbyBuilding.id);
    } else {
      setSelectedBuildingId(null);
    }
  }, [buildingsWithCoords]);

  const startPinDropMode = (building: { id: string; name: string }) => {
    setBuildingToPin(building);
    setPinDropMode(true);
    setDroppedCoords(null);
    toast.info(`Click on the map to set location for "${building.name}"`);
  };

  const cancelPinDropMode = () => {
    setPinDropMode(false);
    setBuildingToPin(null);
    setDroppedCoords(null);
    setConfirmDialogOpen(false);
  };

  const handlePinDrop = useCallback((coords: { lng: number; lat: number }) => {
    setDroppedCoords(coords);
    setConfirmDialogOpen(true);
  }, []);

  const confirmPinDrop = () => {
    if (buildingToPin && droppedCoords) {
      updateCoordsMutation.mutate({
        buildingId: buildingToPin.id,
        lat: droppedCoords.lat,
        lng: droppedCoords.lng,
      });
    }
  };

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
    <div className="space-y-3 sm:space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">Map View</h1>
          <p className="text-sm text-muted-foreground">
            View your buildings on an interactive map
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
          <MapSearchBox
            onLocationSelect={handleLocationSelect}
            className="w-full sm:w-72 lg:w-80"
          />

          <Select value={mapStyle} onValueChange={(v) => setMapStyle(v as MapStyle)}>
            <SelectTrigger className="w-full sm:w-36">
              <Layers className="h-4 w-4 mr-2 shrink-0" />
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

      {/* Pin drop mode banner */}
      {pinDropMode && buildingToPin && (
        <div className="bg-primary text-primary-foreground px-3 py-2.5 sm:px-4 sm:py-3 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4">
          <div className="flex items-center gap-2 sm:gap-3">
            <MousePointer className="h-4 w-4 sm:h-5 sm:w-5 animate-pulse shrink-0" />
            <div className="min-w-0">
              <p className="font-medium text-sm sm:text-base">Pin Drop Mode</p>
              <p className="text-xs sm:text-sm opacity-90 truncate">
                Tap map to set location for <strong className="font-semibold">{buildingToPin.name}</strong>
              </p>
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={cancelPinDropMode}
            className="shrink-0 self-end sm:self-auto"
          >
            <X className="h-4 w-4 mr-1" />
            Cancel
          </Button>
        </div>
      )}

      {/* Stats bar */}
      <div className="flex flex-wrap items-center gap-2 sm:gap-4 text-xs sm:text-sm">
        <Badge variant="secondary" className="gap-1 sm:gap-1.5">
          <Building2 className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
          {isLoading ? '...' : `${buildingsWithCoords.length} mapped`}
        </Badge>
        {buildingsWithoutCoords.length > 0 && (
          <Badge variant="outline" className="gap-1 sm:gap-1.5 text-muted-foreground">
            <MapPin className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
            {buildingsWithoutCoords.length} unset
          </Badge>
        )}
      </div>

      {/* Map */}
      <Card className="overflow-hidden">
        {isLoading ? (
          <Skeleton className="h-[50vh] sm:h-[60vh] lg:h-[600px] w-full" />
        ) : (
          <BuildingMap
            buildings={buildingsWithCoords}
            onBuildingClick={handleBuildingClick}
            selectedBuildingId={selectedBuildingId}
            flyToLocation={flyToLocation}
            mapStyle={mapStyle}
            pinDropMode={pinDropMode}
            onPinDrop={handlePinDrop}
            className="h-[50vh] sm:h-[60vh] lg:h-[600px]"
          />
        )}
      </Card>

      {/* Buildings without coordinates - clickable to set location */}
      {buildingsWithoutCoords.length > 0 && (
        <Card className="border-warning/50 bg-warning/5">
          <CardContent className="py-3 sm:py-4 px-3 sm:px-6">
            <div className="flex items-start gap-2 sm:gap-3">
              <AlertCircle className="h-4 w-4 sm:h-5 sm:w-5 text-warning shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-xs sm:text-sm mb-1.5 sm:mb-2">
                  {buildingsWithoutCoords.length} building{buildingsWithoutCoords.length > 1 ? 's' : ''} need location
                </p>
                <p className="text-xs sm:text-sm text-muted-foreground mb-2 sm:mb-3">
                  Tap a building, then tap the map:
                </p>
                <div className="flex flex-wrap gap-1.5 sm:gap-2">
                  {buildingsWithoutCoords.map((building) => (
                    <Button
                      key={building.id}
                      variant={buildingToPin?.id === building.id ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => startPinDropMode({ id: building.id, name: building.name })}
                      disabled={pinDropMode && buildingToPin?.id !== building.id}
                      className="gap-1 sm:gap-1.5 text-xs sm:text-sm h-7 sm:h-8 px-2 sm:px-3"
                    >
                      <MapPin className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                      <span className="truncate max-w-[120px] sm:max-w-none">{building.name}</span>
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Confirm pin drop dialog */}
      <AlertDialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Location</AlertDialogTitle>
            <AlertDialogDescription>
              Set the location for <strong>{buildingToPin?.name}</strong> to these coordinates?
              <br />
              <span className="font-mono text-xs mt-2 block">
                Lat: {droppedCoords?.lat.toFixed(6)}, Lng: {droppedCoords?.lng.toFixed(6)}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmDialogOpen(false)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmPinDrop}
              disabled={updateCoordsMutation.isPending}
            >
              <Check className="h-4 w-4 mr-1" />
              Confirm Location
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
