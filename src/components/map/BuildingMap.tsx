import { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { MAPBOX_ACCESS_TOKEN, DEFAULT_CENTER, DEFAULT_ZOOM, MAP_STYLES, MapStyle } from '@/lib/mapbox';
import { cn } from '@/lib/utils';

// Set the access token
mapboxgl.accessToken = MAPBOX_ACCESS_TOKEN;

export interface BuildingMarker {
  id: string;
  name: string;
  address: string;
  city: string;
  latitude: number;
  longitude: number;
  logoUrl?: string | null;
}

interface BuildingMapProps {
  buildings: BuildingMarker[];
  onBuildingClick?: (buildingId: string) => void;
  selectedBuildingId?: string | null;
  className?: string;
  mapStyle?: MapStyle;
}

export function BuildingMap({
  buildings,
  onBuildingClick,
  selectedBuildingId,
  className,
  mapStyle = 'streets',
}: BuildingMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: MAP_STYLES[mapStyle],
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
    });

    // Add navigation controls
    map.current.addControl(new mapboxgl.NavigationControl(), 'top-right');
    map.current.addControl(new mapboxgl.FullscreenControl(), 'top-right');
    map.current.addControl(
      new mapboxgl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
      }),
      'top-right'
    );

    map.current.on('load', () => {
      setMapLoaded(true);
    });

    return () => {
      // Clean up markers
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current.clear();
      
      if (popupRef.current) {
        popupRef.current.remove();
      }
      
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    };
  }, []);

  // Update map style
  useEffect(() => {
    if (map.current && mapLoaded) {
      map.current.setStyle(MAP_STYLES[mapStyle]);
    }
  }, [mapStyle, mapLoaded]);

  // Add/update markers
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    const currentIds = new Set(buildings.map((b) => b.id));

    // Remove markers for buildings that no longer exist
    markersRef.current.forEach((marker, id) => {
      if (!currentIds.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    });

    // Add or update markers
    const validBuildings = buildings.filter(
      (b) => b.latitude && b.longitude && !isNaN(b.latitude) && !isNaN(b.longitude)
    );

    validBuildings.forEach((building) => {
      if (markersRef.current.has(building.id)) {
        // Update existing marker position if needed
        const marker = markersRef.current.get(building.id)!;
        marker.setLngLat([building.longitude, building.latitude]);
      } else {
        // Create new marker
        const el = document.createElement('div');
        el.className = 'building-marker';
        el.innerHTML = `
          <div class="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-lg cursor-pointer transition-transform hover:scale-110 border-2 border-background">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect width="16" height="20" x="4" y="2" rx="2" ry="2"/>
              <path d="M9 22v-4h6v4"/>
              <path d="M8 6h.01"/>
              <path d="M16 6h.01"/>
              <path d="M12 6h.01"/>
              <path d="M12 10h.01"/>
              <path d="M12 14h.01"/>
              <path d="M16 10h.01"/>
              <path d="M16 14h.01"/>
              <path d="M8 10h.01"/>
              <path d="M8 14h.01"/>
            </svg>
          </div>
        `;

        const marker = new mapboxgl.Marker(el)
          .setLngLat([building.longitude, building.latitude])
          .addTo(map.current!);

        // Add click handler
        el.addEventListener('click', () => {
          // Show popup
          if (popupRef.current) {
            popupRef.current.remove();
          }

          popupRef.current = new mapboxgl.Popup({
            offset: 25,
            closeButton: true,
            closeOnClick: false,
            className: 'building-popup',
          })
            .setLngLat([building.longitude, building.latitude])
            .setHTML(`
              <div class="p-2 min-w-[200px]">
                <h3 class="font-semibold text-sm mb-1">${building.name}</h3>
                <p class="text-xs text-muted-foreground mb-2">${building.address}</p>
                <p class="text-xs text-muted-foreground">${building.city}</p>
                ${onBuildingClick ? `<button class="mt-2 text-xs text-primary hover:underline view-building-btn" data-id="${building.id}">View Details →</button>` : ''}
              </div>
            `)
            .addTo(map.current!);

          // Add event listener for the view button
          setTimeout(() => {
            const btn = document.querySelector('.view-building-btn');
            if (btn && onBuildingClick) {
              btn.addEventListener('click', () => {
                onBuildingClick(building.id);
              });
            }
          }, 0);
        });

        markersRef.current.set(building.id, marker);
      }
    });

    // Fit bounds to show all markers
    if (validBuildings.length > 0) {
      const bounds = new mapboxgl.LngLatBounds();
      validBuildings.forEach((b) => {
        bounds.extend([b.longitude, b.latitude]);
      });

      map.current.fitBounds(bounds, {
        padding: 50,
        maxZoom: 14,
      });
    }
  }, [buildings, mapLoaded, onBuildingClick]);

  // Highlight selected building
  useEffect(() => {
    markersRef.current.forEach((marker, id) => {
      const el = marker.getElement();
      const markerDiv = el.querySelector('div');
      if (markerDiv) {
        if (id === selectedBuildingId) {
          markerDiv.classList.add('ring-4', 'ring-primary/50', 'scale-110');
        } else {
          markerDiv.classList.remove('ring-4', 'ring-primary/50', 'scale-110');
        }
      }
    });

    // Pan to selected building
    if (selectedBuildingId && map.current) {
      const building = buildings.find((b) => b.id === selectedBuildingId);
      if (building?.latitude && building?.longitude) {
        map.current.flyTo({
          center: [building.longitude, building.latitude],
          zoom: 15,
          duration: 1000,
        });
      }
    }
  }, [selectedBuildingId, buildings]);

  return (
    <div ref={mapContainer} className={cn('w-full h-full min-h-[400px] rounded-lg', className)} />
  );
}
