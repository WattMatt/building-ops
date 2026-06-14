/**
 * CM Footfall + Toilet Fund. Two grids stacked.
 *  - Footfall: per-entrance counts PLUS the building-level Footcount-System vs
 *    Ticksheet reconciliation triad (CM source Page 2 G33/H33/I33 + values),
 *    carried on the centre entrance row.
 *  - Toilet Fund: bales + cash, including the bale variance (issued − stock,
 *    CM source Page 2 I36) distinct from the cash `variance`.
 */
import { EditableGrid, type GridColumn } from '../EditableGrid';
import type { SectionProps } from './types';

const FOOTFALL_COLS: GridColumn[] = [
  { key: 'entrance', label: 'Entrance', type: 'text' },
  { key: 'month_count', label: 'Month', type: 'number' },
  { key: 'ytd_count', label: 'YTD', type: 'number' },
  { key: 'prev_ytd', label: 'Prev YTD', type: 'number' },
  { key: 'variance_pct', label: 'Variance %', type: 'number' },
  // Footcount System vs Ticksheet reconciliation (building-level; on centre row)
  { key: 'system_count', label: 'System Count', type: 'number' },
  { key: 'ticksheet_count', label: 'Ticksheet', type: 'number' },
  { key: 'recon_variance', label: 'Recon Variance', type: 'number' },
  { key: 'source', label: 'Source', type: 'text' },
];

const TOILET_COLS: GridColumn[] = [
  { key: 'issued_bales', label: 'Issued Bales', type: 'number' },
  { key: 'stock_on_hand_bales', label: 'Stock Bales', type: 'number' },
  { key: 'bale_variance', label: 'Bale Variance', type: 'number' },
  { key: 'actual_banked', label: 'Banked', type: 'number' },
  { key: 'budget', label: 'Budget', type: 'number' },
  { key: 'variance', label: 'Cash Variance', type: 'number' },
  { key: 'profit_per_roll', label: 'Profit/Roll', type: 'number' },
];

export const FootfallToiletSection = (p: SectionProps) => (
  <div className="space-y-6">
    <EditableGrid {...p} table="footfall_counts" title="Footfall" hint="Entrance counts, plus the system-vs-ticksheet reconciliation on the centre row." columns={FOOTFALL_COLS} addLabel="Add entrance" />
    <EditableGrid {...p} table="toilet_fund" title="Toilet Fund" hint="Bales (incl. variance) and banked vs budget." columns={TOILET_COLS} addLabel="Add row" />
  </div>
);
