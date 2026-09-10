/**
 * One CSV exporter for the app (spec §8 "Costs"): assets, tenants, PPM plan, cost rollups.
 *
 * - RFC 4180: a cell is wrapped in double quotes when it contains a quote, a comma, or a
 *   line break; embedded quotes are doubled. Every cell is otherwise written verbatim.
 * - UTF-8 BOM so Excel opens accented text correctly; CRLF row endings (RFC 4180 §2.1).
 * - Download goes through a Blob + object URL + anchor click — the same path the XLSX
 *   writers used, which works inside the PWA sandbox where `navigator.msSaveBlob` and
 *   `data:` links do not.
 */

export interface CsvColumn<Row> {
  /** Property read from each row when `format` is not given. */
  key: keyof Row & string;
  /** Header cell text. */
  header: string;
  /** Turns the raw value into the cell text; receives the whole row for derived columns. */
  format?: (value: Row[keyof Row & string], row: Row) => string;
}

const BOM = '\uFEFF';
const CRLF = '\r\n';

/** Quotes a single cell per RFC 4180; `null`/`undefined` become an empty cell. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'string' ? value : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Builds the CSV text (with BOM and CRLF endings) without downloading it. */
export function toCsv<Row>(rows: readonly Row[], columns: readonly CsvColumn<Row>[]): string {
  const header = columns.map((c) => csvCell(c.header)).join(',');
  const body = rows.map((row) =>
    columns
      .map((c) => {
        const raw = row[c.key];
        const text = c.format ? c.format(raw, row) : raw;
        return csvCell(text);
      })
      .join(','),
  );
  return BOM + [header, ...body].join(CRLF) + CRLF;
}

/** Downloads `rows` as `filename` (".csv" is appended when missing). */
export function exportCsv<Row>(rows: readonly Row[], columns: readonly CsvColumn<Row>[], filename: string): void {
  const csv = toCsv(rows, columns);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.toLowerCase().endsWith('.csv') ? filename : `${filename}.csv`;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick: some browsers start the download asynchronously.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
