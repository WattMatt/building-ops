// Mapbox configuration
// This is a publishable token - safe to include in client-side code
export const MAPBOX_ACCESS_TOKEN = 'pk.eyJ1IjoiYXJub21hdHQiLCJhIjoiY21pbmI5MXhjMTVuZTNncjFxZmQ1ZG1hbCJ9.-h3l7pr8faTRwcbnQDfmHw';

// Default map center (South Africa)
export const DEFAULT_CENTER: [number, number] = [25.0, -29.0];
export const DEFAULT_ZOOM = 5;

// Map styles
export const MAP_STYLES = {
  streets: 'mapbox://styles/mapbox/streets-v12',
  satellite: 'mapbox://styles/mapbox/satellite-streets-v12',
  light: 'mapbox://styles/mapbox/light-v11',
  dark: 'mapbox://styles/mapbox/dark-v11',
} as const;

export type MapStyle = keyof typeof MAP_STYLES;
