import { useEffect, useRef, useState } from 'react';

export interface GeotagPosition {
  lat: number;
  lng: number;
}

const FIX_TTL_MS = 5 * 60 * 1000;

// One fix per session (refreshed after five minutes) so a batch of photos does
// not trigger a permission prompt or a GPS wake-up for every capture.
let cachedFix: { position: GeotagPosition; at: number } | null = null;
let inFlight: Promise<GeotagPosition | null> | null = null;

function requestFix(): Promise<GeotagPosition | null> {
  if (cachedFix && Date.now() - cachedFix.at < FIX_TTL_MS) {
    return Promise.resolve(cachedFix.position);
  }
  if (inFlight) return inFlight;
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve(null);
  }
  inFlight = new Promise<GeotagPosition | null>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const position = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        cachedFix = { position, at: Date.now() };
        inFlight = null;
        resolve(position);
      },
      () => {
        // Denied, unavailable, or timed out: the caption simply omits the location.
        inFlight = null;
        resolve(null);
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: FIX_TTL_MS }
    );
  });
  return inFlight;
}

/**
 * Best-effort device location for the photo caption. Returns `null` until a fix
 * arrives, when `enabled` is false, or when the user has declined permission.
 */
export function useGeotag(enabled: boolean): { position: GeotagPosition | null } {
  const [position, setPosition] = useState<GeotagPosition | null>(() =>
    enabled && cachedFix && Date.now() - cachedFix.at < FIX_TTL_MS ? cachedFix.position : null
  );
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      setPosition(null);
      return;
    }
    requestFix().then((fix) => {
      if (mounted.current) setPosition(fix);
    });
  }, [enabled]);

  return { position };
}
