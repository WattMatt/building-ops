/**
 * Provenance caption burned into every photo taken through PhotoCapture.
 *
 * Canvas re-encoding strips EXIF, so this strip is the only capture-time
 * evidence (when, and optionally where) that survives into the stored file.
 */
import { OPERATING_TZ } from '@/lib/myWork';

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface CaptionLayout {
  fontPx: number;
  padPx: number;
  stripPx: number;
}

// Written by hand rather than trusting the locale's abbreviation: en-ZA on some
// ICU builds emits "Sept", and the caption must read the same on every device.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const partsFormatter = new Intl.DateTimeFormat('en-ZA', {
  timeZone: OPERATING_TZ,
  day: '2-digit',
  month: 'numeric',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** `DD Mon YYYY, HH:MM` in the operating timezone, plus ` · lat, lng` (4 dp) when a fix is given. */
export function captionText(at: Date, position: GeoPoint | null): string {
  const parts: Record<string, string> = {};
  for (const p of partsFormatter.formatToParts(at)) {
    if (p.type !== 'literal') parts[p.type] = p.value;
  }
  const day = parts.day.padStart(2, '0');
  const month = MONTHS[Number(parts.month) - 1] ?? parts.month;
  // Some ICU builds render midnight as "24" with hour12:false; normalise to 00.
  const hour = (parts.hour === '24' ? '00' : parts.hour).padStart(2, '0');
  const minute = parts.minute.padStart(2, '0');
  const time = `${day} ${month} ${parts.year}, ${hour}:${minute}`;
  if (!position) return time;
  return `${time} · ${position.lat.toFixed(4)}, ${position.lng.toFixed(4)}`;
}

/** Strip geometry scales with the shorter side so the text stays legible at any resolution. */
export function captionLayout(width: number, height: number): CaptionLayout {
  const fontPx = Math.max(12, Math.round(Math.min(width, height) * 0.022));
  const padPx = Math.round(fontPx / 2);
  return { fontPx, padPx, stripPx: fontPx + 2 * padPx };
}

/** Paint a translucent strip along the bottom edge and write the caption into it. */
export function drawCaption(ctx: CanvasRenderingContext2D, width: number, height: number, text: string): void {
  const { fontPx, padPx, stripPx } = captionLayout(width, height);
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, height - stripPx, width, stripPx);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `${fontPx}px system-ui, -apple-system, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, padPx, height - stripPx / 2);
}
