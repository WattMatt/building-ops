/**
 * The one "Export CSV" button. Every register, grid and list in the app exports through this,
 * so the disabled rule, the filename shape and the success toast cannot drift between surfaces
 * (they already had: two call sites lost `size="sm"`, two kept a dead error toast behind a
 * button that was disabled in exactly that case).
 *
 * Filename: the caller passes a BASE name only — this appends `_<yyyy-mm-dd>` (the operating
 * timezone's today) and `.csv`, and strips anything that is not filename-safe. No caller
 * passes an id: a landlord opening their Downloads folder should see `assets_2026-09-11.csv`,
 * not a uuid.
 */
import { Download } from 'lucide-react';
import { toast } from 'sonner';
import { Button, type ButtonProps } from '@/components/ui/button';
import { exportCsv, type CsvColumn } from '@/lib/exportCsv';
import { todayInOperatingTz } from '@/lib/myWork';

export interface ExportCsvButtonProps<Row> {
  /** Exactly the rows on screen — the caller filters, this never does. */
  rows: readonly Row[];
  columns: readonly CsvColumn<Row>[];
  /** Base name, no date and no extension: `assets`, `checklists-daily`, `ppm-grid-2026`. */
  filename: string;
  label?: string;
  /** An extra gate on top of "there is nothing to export" (e.g. a dependent query still loading). */
  disabled?: boolean;
  /**
   * Why this export cannot run right now. The button stays ENABLED and says this on click —
   * a disabled button with no explanation is the bug, not the guard.
   */
  blockedReason?: string | null;
  className?: string;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
}

/** `Assets / 2026` → `assets-2026`: lower case, no spaces, nothing a filesystem argues with. */
export function csvFileName(base: string, today = todayInOperatingTz()): string {
  const safe = base
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
  return `${safe || 'export'}_${today}.csv`;
}

export function ExportCsvButton<Row>({
  rows,
  columns,
  filename,
  label = 'Export CSV',
  disabled,
  blockedReason,
  className = 'min-h-11',
  variant = 'outline',
  size = 'sm',
}: ExportCsvButtonProps<Row>) {
  const nothingToExport = rows.length === 0 && !blockedReason;

  const onClick = () => {
    if (blockedReason) {
      toast.error(blockedReason);
      return;
    }
    exportCsv(rows, columns, csvFileName(filename));
    toast.success(`Exported ${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`);
  };

  return (
    <Button variant={variant} size={size} className={className} onClick={onClick} disabled={disabled || nothingToExport}>
      <Download className="mr-2 h-4 w-4" />
      {label}
    </Button>
  );
}

export default ExportCsvButton;
