import { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { MAPBOX_ACCESS_TOKEN, DEFAULT_CENTER, DEFAULT_ZOOM, MAP_STYLES, MapStyle } from '@/lib/mapbox';
import { cn } from '@/lib/utils';
import { getBuildingAvatarHtml } from '@/components/building/BuildingAvatar';

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
  logoPosition?: string | null;
  avatarColor?: string | null;
}

interface BuildingMapProps {
  buildings: BuildingMarker[];
  onBuildingClick?: (buildingId: string) => void;
  selectedBuildingId?: string | null;
  flyToLocation?: { lng: number; lat: number } | null;
  className?: string;
  mapStyle?: MapStyle;
  /** Enable pin drop mode - when true, clicking on map will call onPinDrop */
  pinDropMode?: boolean;
  /** Callback when user clicks on map in pin drop mode */
  onPinDrop?: (coords: { lng: number; lat: number }) => void;
}

export function BuildingMap({
  buildings,
  onBuildingClick,
  selectedBuildingId,
  flyToLocation,
  className,
  mapStyle = 'streets',
  pinDropMode = false,
  onPinDrop,
}: BuildingMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const pinDropMarkerRef = useRef<mapboxgl.Marker | null>(null);
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

          const avatarHtml = getBuildingAvatarHtml(building.name, building.logoUrl, building.avatarColor, 'md');
          const logoPosition = building.logoPosition || 'top-left';
          
          // Determine logo position styles for popup
          const logoPositionStyles: Record<string, string> = {
            'top-left': 'left: 8px;',
            'top-center': 'left: 50%; transform: translateX(-50%);',
            'top-right': 'right: 8px;',
          };
          const logoStyle = logoPositionStyles[logoPosition] || logoPositionStyles['top-left'];
          
          // Build logo HTML if logo exists (and not a dicebear pattern)
          const hasCustomLogo = building.logoUrl && !building.logoUrl.includes('dicebear');
          const logoHtml = hasCustomLogo 
            ? `<div style="position: absolute; top: 8px; ${logoStyle} z-index: 10;">
                <img src="${building.logoUrl}" alt="Logo" style="width: 28px; height: 28px; object-fit: contain; border-radius: 6px; background: rgba(255,255,255,0.95); border: 1px solid rgba(0,0,0,0.08); box-shadow: 0 1px 3px rgba(0,0,0,0.1);" />
              </div>`
            : '';
          
          popupRef.current = new mapboxgl.Popup({
            offset: 25,
            closeButton: true,
            closeOnClick: false,
            className: 'building-popup',
            maxWidth: '280px',
          })
            .setLngLat([building.longitude, building.latitude])
            .setHTML(`
              <div class="building-popup-content" style="position: relative; padding: 12px; min-width: 220px;">
                ${logoHtml}
                <div style="padding-top: ${hasCustomLogo ? '32px' : '0'};">
                  <div style="display: flex; align-items: flex-start; gap: 10px;">
                    ${avatarHtml}
                    <div style="flex: 1; min-width: 0;">
                      <h3 style="font-weight: 600; font-size: 14px; margin: 0 0 4px 0; color: var(--foreground, #1a1a1a);">${building.name}</h3>
                      <p style="font-size: 12px; margin: 0; color: var(--muted-foreground, #6b7280); display: flex; align-items: center; gap: 4px;">
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/>
                          <circle cx="12" cy="10" r="3"/>
                        </svg>
                        ${building.city}
                      </p>
                    </div>
                  </div>
                  <p style="font-size: 11px; color: var(--muted-foreground, #6b7280); margin: 8px 0 0 0; line-height: 1.4;">${building.address}</p>
                  ${onBuildingClick ? `
                    <button class="view-building-btn" data-id="${building.id}" style="
                      margin-top: 10px;
                      width: 100%;
                      padding: 6px 12px;
                      font-size: 12px;
                      font-weight: 500;
                      color: var(--primary-foreground, #fff);
                      background: var(--primary, #2563eb);
                      border: none;
                      border-radius: 6px;
                      cursor: pointer;
                      display: flex;
                      align-items: center;
                      justify-content: center;
                      gap: 4px;
                      transition: opacity 0.15s;
                    " onmouseover="this.style.opacity='0.9'" onmouseout="this.style.opacity='1'">
                      View Details
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M5 12h14"/>
                        <path d="m12 5 7 7-7 7"/>
                      </svg>
                    </button>
                  ` : ''}
                </div>
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

  // Fly to searched location
  useEffect(() => {
    if (flyToLocation && map.current && mapLoaded) {
      map.current.flyTo({
        center: [flyToLocation.lng, flyToLocation.lat],
        zoom: 14,
        duration: 1500,
      });
    }
  }, [flyToLocation, mapLoaded]);

  // Handle pin drop mode
  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    const handleClick = (e: mapboxgl.MapMouseEvent) => {
      if (!pinDropMode || !onPinDrop) return;

      const { lng, lat } = e.lngLat;

      // Remove existing pin drop marker
      if (pinDropMarkerRef.current) {
        pinDropMarkerRef.current.remove();
      }

      // Create new pin drop marker with distinct style
      const el = document.createElement('div');
      el.innerHTML = `
        <div class="relative">
          <div class="w-8 h-8 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center shadow-lg animate-bounce border-2 border-background">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/>
              <circle cx="12" cy="10" r="3"/>
            </svg>
          </div>
          <div class="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-destructive rotate-45"></div>
        </div>
      `;

      pinDropMarkerRef.current = new mapboxgl.Marker(el)
        .setLngLat([lng, lat])
        .addTo(map.current!);

      onPinDrop({ lng, lat });
    };

    map.current.on('click', handleClick);

    // Update cursor based on pin drop mode
    if (pinDropMode) {
      map.current.getCanvas().style.cursor = 'crosshair';
    } else {
      map.current.getCanvas().style.cursor = '';
      // Remove pin drop marker when exiting pin drop mode
      if (pinDropMarkerRef.current) {
        pinDropMarkerRef.current.remove();
        pinDropMarkerRef.current = null;
      }
    }

    return () => {
      if (map.current) {
        map.current.off('click', handleClick);
      }
    };
  }, [pinDropMode, onPinDrop, mapLoaded]);

  return (
    <div ref={mapContainer} className={cn('w-full h-full min-h-[400px] rounded-lg', className)} />
  );
}
