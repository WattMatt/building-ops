import { useEffect } from 'react';
import { useOrganization } from './useOrganization';

// Convert hex color to HSL values
function hexToHSL(hex: string): { h: number; s: number; l: number } | null {
  // Remove # if present
  hex = hex.replace(/^#/, '');
  
  if (hex.length !== 6) return null;
  
  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

// Generate a lighter version for sidebar primary
function lightenHSL(h: number, s: number, l: number, amount: number): string {
  const newL = Math.min(100, l + amount);
  return `${h} ${s}% ${newL}%`;
}

export function useOrganizationTheme() {
  const { organization } = useOrganization();

  useEffect(() => {
    if (!organization?.primary_color) return;

    const hsl = hexToHSL(organization.primary_color);
    if (!hsl) return;

    const { h, s, l } = hsl;
    const primaryHSL = `${h} ${s}% ${l}%`;
    const primaryLighterHSL = lightenHSL(h, s, l, 10);

    // Apply to CSS variables
    const root = document.documentElement;
    
    // Primary colors
    root.style.setProperty('--primary', primaryHSL);
    root.style.setProperty('--ring', primaryHSL);
    
    // Sidebar primary (slightly lighter for dark background)
    root.style.setProperty('--sidebar-primary', primaryLighterHSL);
    root.style.setProperty('--sidebar-ring', primaryLighterHSL);
    
    // Chart primary color
    root.style.setProperty('--chart-1', primaryHSL);

    // Cleanup function to reset on unmount
    return () => {
      root.style.removeProperty('--primary');
      root.style.removeProperty('--ring');
      root.style.removeProperty('--sidebar-primary');
      root.style.removeProperty('--sidebar-ring');
      root.style.removeProperty('--chart-1');
    };
  }, [organization?.primary_color]);

  // Point the browser-tab favicon at the organization logo so it matches the
  // logo shown under branding. When no org logo is set, the static icons from
  // index.html remain in place.
  useEffect(() => {
    const logoUrl = organization?.logo_url;
    if (!logoUrl) return;

    const head = document.head;
    // Remove the typed default icons (favicon.ico / favicon.svg). Their declared
    // MIME types would make the browser reject a logo of a different format, so
    // we swap in a single untyped icon link and let the browser sniff it.
    const defaults = Array.from(
      head.querySelectorAll<HTMLLinkElement>("link[rel~='icon']")
    );
    defaults.forEach((l) => l.remove());

    const link = document.createElement('link');
    link.rel = 'icon';
    link.href = logoUrl;
    head.appendChild(link);

    // Restore the static defaults if the logo clears or the app unmounts.
    return () => {
      link.remove();
      defaults.forEach((l) => head.appendChild(l));
    };
  }, [organization?.logo_url]);

  return { organization };
}
