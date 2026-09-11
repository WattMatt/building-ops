/**
 * The colour legend every PPM grid shows — the building's PPM tab and the report section
 * share it so the two grids cannot drift apart in what a colour means.
 *
 *   <PpmLegend blankLabel="No occurrence" />                 // building tab: derived only
 *   <PpmLegend blankLabel="Blank" showOverride />            // report section: overrides too
 */
import { PPM_STATUS_STYLE, type PpmCellStatus } from '@/lib/ppmGrid';

interface Props {
  /** What an empty cell means on this grid. */
  blankLabel: string;
  /** Show the override chip entry (grids where a manager can pin a cell). */
  showOverride?: boolean;
}

export function PpmLegend({ blankLabel, showOverride = false }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground" data-testid="ppm-legend">
      {(Object.keys(PPM_STATUS_STYLE) as PpmCellStatus[]).map((s) => (
        <span key={s} className="flex items-center gap-1.5">
          <span className={`inline-block h-3 w-3 rounded-sm ${PPM_STATUS_STYLE[s].cls}`} />
          {PPM_STATUS_STYLE[s].label}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-3 w-3 rounded-sm border border-border bg-background" />
        {blankLabel}
      </span>
      {showOverride && (
        <span className="flex items-center gap-1.5">
          <span className="relative inline-block h-3 w-3 rounded-sm border border-border bg-background">
            <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-primary" />
          </span>
          Override (note on hover)
        </span>
      )}
    </div>
  );
}
