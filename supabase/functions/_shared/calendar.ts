/**
 * Calendar event model + ICS renderer (R3b, spec §7). Pure: no I/O, no Deno or browser
 * globals beyond `Intl`, `Date` and `TextEncoder`, so the same file is bundled into the
 * `ics-feed` edge function and re-exported to the web app from `src/lib/calendar/*`
 * (unit-tested there under vitest, like `notifyRules.ts`).
 *
 * Row inputs are minimal structural types — whatever the caller selects from Supabase
 * must simply carry these columns. The generated database types are deliberately not
 * imported here so the edge bundle stays independent of `src/`.
 */

export const CALENDAR_KINDS = ['task', 'issue', 'document', 'asset', 'ppm', 'signoff', 'report'] as const;
export type CalendarKind = (typeof CALENDAR_KINDS)[number];

export type CalendarStatus = 'open' | 'overdue' | 'done' | 'na';

export interface CalendarEvent {
  /** Unique per event: `<kind>-<entityId>`, plus `-<YYYY-MM>` for PPM month cells. Also the ICS UID stem. */
  id: string;
  kind: CalendarKind;
  title: string;
  /** All-day date, `YYYY-MM-DD` in the operating timezone (SAST). */
  date: string;
  buildingId: string | null;
  buildingName: string | null;
  /** App-relative link to the entity (the ICS `URL` is `appUrl + href`). */
  href: string;
  status: CalendarStatus;
  /** Id of the underlying row — what the UI needs to open the entity's dialog. */
  entityId: string;
}

/** Human labels per source; also the first half of the ICS DESCRIPTION. */
export const KIND_LABELS: Record<CalendarKind, string> = {
  task: 'Task',
  issue: 'Issue',
  document: 'Document expiry',
  asset: 'Asset service',
  ppm: 'PPM service',
  signoff: 'Sign-off',
  report: 'Report',
};

/** Tailwind token classes per source (theme tokens only — never hex). */
export const KIND_COLORS: Record<CalendarKind, string> = {
  task: 'bg-primary/15 text-primary',
  issue: 'bg-destructive/15 text-destructive',
  document: 'bg-warning/15 text-warning',
  asset: 'bg-info/15 text-info',
  ppm: 'bg-success/15 text-success',
  signoff: 'bg-accent text-accent-foreground',
  report: 'bg-secondary text-secondary-foreground',
};

// ---------------------------------------------------------------------------------------
// Row shapes (structural; see module note)
// ---------------------------------------------------------------------------------------

export interface TaskRow {
  id: string;
  task_name: string;
  due_date: string;
  status: string;
  building_id: string | null;
}

export interface IssueRow {
  id: string;
  title: string;
  deadline: string | null;
  status: string;
  building_id: string | null;
}

export interface DocumentRow {
  id: string;
  name: string;
  expiry_date: string | null;
  building_id: string | null;
}

export interface AssetRow {
  id: string;
  name: string;
  next_service_date: string | null;
  building_id: string | null;
}

/** One `ppm_services.months` cell — mirrors `PpmCell` in `src/lib/ppmStatus.ts`. */
export interface PpmMonthCell {
  status?: 'due' | 'done' | 'missed' | 'na';
  date?: string | null;
}

export interface PpmRow {
  id: string;
  service_name: string;
  building_id: string | null;
  report_id: string | null;
  /** The raw jsonb grid; callers pass it through untyped and `ppmEvents` narrows it. */
  months: unknown;
}

export interface SignoffRequestRow {
  id: string;
  submission_id: string;
  due_at: string | null;
  status: string;
}

export interface SignoffSubmissionRow {
  form_name: string;
  building_id: string | null;
}

export interface ReportRow {
  id: string;
  building_id: string | null;
  report_period: string;
  status: string;
}

// ---------------------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------------------

export const OPERATING_TZ = 'Africa/Johannesburg';

const sastDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: OPERATING_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** `YYYY-MM-DD` of an instant in the operating timezone. */
export function toOperatingDate(instant: Date | string): string {
  return sastDay.format(typeof instant === 'string' ? new Date(instant) : instant);
}

/** Today's `YYYY-MM-DD` in the operating timezone (a duplicate of `myWork.todayInOperatingTz`, kept here so the edge bundle needs no `src/` import). */
export function todayInOperatingTz(now: Date = new Date()): string {
  return sastDay.format(now);
}

/** The calendar day after `YYYY-MM-DD` (UTC arithmetic — dates only, no timezone in play). */
export function nextDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------------------

const buildingHref = (buildingId: string | null, tab: string) => `/buildings/${buildingId ?? ''}?tab=${tab}`;

/** Past-due helper: strict lexical compare works because both are `YYYY-MM-DD`. */
const isPast = (date: string, today: string) => date < today;

export function taskEvent(row: TaskRow, buildingName: string | null, today: string): CalendarEvent {
  let status: CalendarStatus = 'open';
  if (row.status === 'completed') status = 'done';
  else if (row.status === 'overdue' || (row.status === 'pending' && isPast(row.due_date, today))) status = 'overdue';
  return {
    id: `task-${row.id}`,
    kind: 'task',
    title: row.task_name,
    date: row.due_date,
    buildingId: row.building_id,
    buildingName,
    href: buildingHref(row.building_id, 'checklists'),
    status,
    entityId: row.id,
  };
}

export function issueEvent(row: IssueRow, buildingName: string | null, today: string): CalendarEvent | null {
  if (!row.deadline) return null;
  const resolved = row.status === 'resolved' || row.status === 'closed';
  const status: CalendarStatus = resolved ? 'done' : isPast(row.deadline, today) ? 'overdue' : 'open';
  return {
    id: `issue-${row.id}`,
    kind: 'issue',
    title: row.title,
    date: row.deadline,
    buildingId: row.building_id,
    buildingName,
    href: `/issues?open=${row.id}`,
    status,
    entityId: row.id,
  };
}

export function documentEvent(row: DocumentRow, buildingName: string | null, today: string): CalendarEvent | null {
  if (!row.expiry_date) return null;
  return {
    id: `document-${row.id}`,
    kind: 'document',
    title: row.name,
    date: row.expiry_date,
    buildingId: row.building_id,
    buildingName,
    href: buildingHref(row.building_id, 'documents'),
    status: isPast(row.expiry_date, today) ? 'overdue' : 'open',
    entityId: row.id,
  };
}

export function assetEvent(row: AssetRow, buildingName: string | null, today: string): CalendarEvent | null {
  if (!row.next_service_date) return null;
  return {
    id: `asset-${row.id}`,
    kind: 'asset',
    title: row.name,
    date: row.next_service_date,
    buildingId: row.building_id,
    buildingName,
    href: buildingHref(row.building_id, 'assets'),
    status: isPast(row.next_service_date, today) ? 'overdue' : 'open',
    entityId: row.id,
  };
}

/**
 * One event per `due` / `missed` month cell. `done` and `na` cells are history, not
 * calendar items. Day = the cell's `date` when set, else the 1st of the month. A `due`
 * cell whose day has passed reads as overdue (a manager may not have flagged it `missed` yet).
 */
const isMonthGrid = (v: unknown): v is Record<string, PpmMonthCell | null | undefined> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function ppmEvents(row: PpmRow, buildingName: string | null, today: string): CalendarEvent[] {
  const months = isMonthGrid(row.months) ? row.months : {};
  const href = row.report_id ? `/reports/fortress/${row.report_id}` : buildingHref(row.building_id, 'maintenance');
  const out: CalendarEvent[] = [];
  for (const month of Object.keys(months).sort()) {
    const cell = months[month];
    if (!cell || typeof cell !== 'object' || (cell.status !== 'due' && cell.status !== 'missed')) continue;
    const date = typeof cell.date === 'string' && cell.date ? cell.date : `${month}-01`;
    out.push({
      id: `ppm-${row.id}-${month}`,
      kind: 'ppm',
      title: row.service_name,
      date,
      buildingId: row.building_id,
      buildingName,
      href,
      status: cell.status === 'missed' || isPast(date, today) ? 'overdue' : 'open',
      entityId: row.id,
    });
  }
  return out;
}

/**
 * `due_at` is a timestamptz; the event day is that instant's SAST calendar day. A request
 * whose submission is missing (not visible to the caller) yields no event.
 */
export function signoffEvent(
  req: SignoffRequestRow,
  submission: SignoffSubmissionRow | null | undefined,
  buildingName: string | null,
  today: string = todayInOperatingTz(),
): CalendarEvent | null {
  if (!req.due_at || !submission) return null;
  const date = toOperatingDate(req.due_at);
  const status: CalendarStatus = req.status !== 'pending' ? 'done' : isPast(date, today) ? 'overdue' : 'open';
  return {
    id: `signoff-${req.id}`,
    kind: 'signoff',
    title: submission.form_name,
    date,
    buildingId: submission.building_id,
    buildingName,
    href: '/my-signoffs',
    status,
    entityId: req.id,
  };
}

/**
 * Report periods are never "overdue" — a monthly report is compiled after its period — so
 * `today` is accepted only to keep every mapper on the same `(row, buildingName, today)` shape.
 */
export function reportEvent(row: ReportRow, buildingName: string | null, _today?: string): CalendarEvent {
  return {
    id: `report-${row.id}`,
    kind: 'report',
    title: 'Fortress report',
    date: row.report_period,
    buildingId: row.building_id,
    buildingName,
    href: `/reports/fortress/${row.id}`,
    status: row.status === 'approved' ? 'done' : 'open',
    entityId: row.id,
  };
}

// ---------------------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------------------

const KIND_ORDER: Record<CalendarKind, number> = Object.fromEntries(
  CALENDAR_KINDS.map((k, i) => [k, i]),
) as Record<CalendarKind, number>;

/** Date, then source order (tasks first), then title, then id — total and stable. Returns a new array. */
export function sortEvents(events: readonly CalendarEvent[]): CalendarEvent[] {
  return [...events].sort(
    (a, b) =>
      (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) ||
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      (a.title < b.title ? -1 : a.title > b.title ? 1 : 0) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/** `'YYYY-MM-DD' → [events…]`; keys ascend and each day's list is sorted. `get(day) ?? []` for a grid cell. */
export function groupByDate(events: readonly CalendarEvent[]): Map<string, CalendarEvent[]> {
  const out = new Map<string, CalendarEvent[]>();
  for (const e of sortEvents(events)) {
    const list = out.get(e.date);
    if (list) list.push(e);
    else out.set(e.date, [e]);
  }
  return out;
}

/** Events with `from <= date <= to` (both `YYYY-MM-DD`, inclusive). */
export function inRange(events: readonly CalendarEvent[], from: string, to: string): CalendarEvent[] {
  return events.filter((e) => e.date >= from && e.date <= to);
}

// ---------------------------------------------------------------------------------------
// ICS (RFC 5545)
// ---------------------------------------------------------------------------------------

export interface RenderIcsOptions {
  /** `X-WR-CALNAME` — what calendar apps show as the subscription's name. */
  name: string;
  prodId?: string;
  /** Origin (no trailing slash) prepended to each event's `href` for the `URL` property. */
  appUrl: string;
  /** DTSTAMP instant; injectable so output is deterministic in tests. */
  now?: Date;
}

const UID_DOMAIN = 'buildingops.app';
const FOLD_OCTETS = 75;
const CRLF = '\r\n';

/** RFC 5545 §3.3.11 TEXT escaping: backslash, semicolon, comma, and newlines as `\n`. */
export function escapeIcsText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
}

const utf8Len = (cp: number) => (cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4);

/**
 * RFC 5545 §3.1 folding: no line longer than 75 octets, continuation lines start with a
 * single space (which counts toward the 75). Splits on code points so multi-byte characters
 * are never cut.
 */
export function foldIcsLine(line: string): string {
  if (new TextEncoder().encode(line).length <= FOLD_OCTETS) return line;
  const out: string[] = [];
  let cur = '';
  let curOctets = 0;
  let limit = FOLD_OCTETS; // the first physical line has no leading space
  for (const ch of line) {
    const n = utf8Len(ch.codePointAt(0) as number);
    if (curOctets + n > limit) {
      out.push(cur);
      cur = ' ';
      curOctets = 1;
      limit = FOLD_OCTETS;
    }
    cur += ch;
    curOctets += n;
  }
  out.push(cur);
  return out.join(CRLF);
}

const icsDate = (date: string) => date.replace(/-/g, '');
const icsStamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

function vevent(e: CalendarEvent, appUrl: string, stamp: string): string[] {
  const summary = e.buildingName ? `${e.title} · ${e.buildingName}` : e.title;
  return [
    'BEGIN:VEVENT',
    `UID:${e.id}@${UID_DOMAIN}`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${icsDate(e.date)}`,
    `DTEND;VALUE=DATE:${icsDate(nextDay(e.date))}`,
    `SUMMARY:${escapeIcsText(summary)}`,
    `DESCRIPTION:${escapeIcsText(`${KIND_LABELS[e.kind]} — ${e.status}`)}`,
    `URL:${appUrl}${e.href}`,
    'STATUS:CONFIRMED',
    `CATEGORIES:${e.kind.toUpperCase()}`,
    'END:VEVENT',
  ];
}

/**
 * Render a complete `text/calendar` document. Events are sorted so equal input renders
 * byte-identical output; every event is all-day (`VALUE=DATE`, DTEND = next day).
 */
export function renderIcs(events: readonly CalendarEvent[], opts: RenderIcsOptions): string {
  const stamp = icsStamp(opts.now ?? new Date());
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${opts.prodId ?? '-//Building Ops//EN'}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(opts.name)}`,
  ];
  for (const e of sortEvents(events)) lines.push(...vevent(e, opts.appUrl, stamp));
  lines.push('END:VCALENDAR');
  return lines.map(foldIcsLine).join(CRLF) + CRLF;
}
