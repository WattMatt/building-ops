/**
 * Readable text on an arbitrary brand colour. Shared by the two public, unauthenticated pages
 * (the share page and the tenant intake form), which both paint a header in whatever hex an admin
 * typed. It lives here rather than in either page so neither page's chunk has to pull the other's.
 */

/** WCAG relative luminance of a `#rrggbb` colour: 0 for black, 1 for white. */
function relativeLuminance(hex: string): number {
  const channel = (byte: number) => {
    const c = byte / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel(parseInt(hex.slice(1, 3), 16)) +
    0.7152 * channel(parseInt(hex.slice(3, 5), 16)) +
    0.0722 * channel(parseInt(hex.slice(5, 7), 16))
  );
}

/**
 * Black or white on the org's brand colour, whichever contrasts better. The colour is arbitrary
 * (an admin types it), so fixed white text is a readability bug on every pale brand — yellow, cream,
 * pale grey — and a public page has no signed-in fallback to fall back to.
 */
export function headerTextColor(hex: string): '#000000' | '#ffffff' {
  const l = relativeLuminance(hex);
  // Contrast against white is 1.05 / (l + 0.05); against black it is (l + 0.05) / 0.05.
  return (l + 0.05) / 0.05 > 1.05 / (l + 0.05) ? '#000000' : '#ffffff';
}
