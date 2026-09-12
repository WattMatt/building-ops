/**
 * Pure composition of one person's daily digest: no I/O and no Deno/Node APIs, so it is
 * unit-tested from the web app's vitest suite (src/lib/digest.test.ts) and bundled into the
 * `daily-digest` edge function. Keeping the shaping here means the Deno file — which cannot
 * be run locally — holds only queries and rendering.
 *
 * `today` is a `YYYY-MM-DD` string in the operating timezone (Africa/Johannesburg), and
 * `due_date` is compared to it as a string: ISO dates sort lexicographically, so `<` is
 * "before today" and `===` is "today" without pulling in date arithmetic.
 */

export interface DigestTask {
  id: string;
  task_name: string;
  due_date: string;
  building_name: string | null;
}

export interface DigestIssue {
  id: string;
  title: string;
  priority: string;
  building_name: string | null;
}

/** Portfolio-wide expiry counts by window (expiring_items(90) bucketed by days_left). */
export interface ExpiryBuckets { expired: number; d30: number; d60: number; d90: number }

/** One row of `portfolio_coverage()` (the columns the digest reads; the full row has more). */
export interface CoverageRow {
  building_id: string;
  building_name: string;
  field_members: number;
  unassigned_open: number;
  due_yesterday: number;
  completed_yesterday: number;
}

/** What the Coverage section says, shaped once per run from the service-role call. */
export interface CoverageSummary {
  /** Buildings with no active field member. */
  noTeam: string[];
  /** Open (pending or overdue) tasks across the portfolio with nobody assigned. */
  unassignedOpen: number;
  /** Buildings that had daily tasks due yesterday and completed none of them. */
  silentYesterday: string[];
}

/** Pure shaping of the RPC rows; null when every line would be empty so the caller can pass nothing. */
export function coverageSummary(rows: CoverageRow[]): CoverageSummary | null {
  const s: CoverageSummary = {
    noTeam: rows.filter((r) => r.field_members === 0).map((r) => r.building_name),
    unassignedOpen: rows.reduce((n, r) => n + r.unassigned_open, 0),
    silentYesterday: rows.filter((r) => r.due_yesterday > 0 && r.completed_yesterday === 0).map((r) => r.building_name),
  };
  return s.noTeam.length || s.unassignedOpen || s.silentYesterday.length ? s : null;
}

export interface DigestInput {
  /** Today in the operating timezone, `YYYY-MM-DD`. */
  today: string;
  tasks: DigestTask[];
  issues: DigestIssue[];
  /** Portfolio-wide expiry counts; only admins and managers get this section. */
  expiring?: ExpiryBuckets | null;
  /** Portfolio coverage gaps; only admins and managers get this section. */
  coverage?: CoverageSummary | null;
  unread: number;
}

/** One block of the email: an `<h3>` heading and, usually, an `<ul>` of plain-text lines. */
export interface DigestSection {
  heading: string;
  lines: string[];
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/**
 * Most lines any one section lists. Someone holding sixty overdue tasks needs a nudge to open
 * the app, not sixty lines of email; the heading still carries the true count, so nothing is
 * hidden by the cap.
 */
export const SECTION_MAX = 15;

/** Cap a section's lines, replacing the remainder with a single "…and N more" line. */
function capLines(lines: string[]): string[] {
  if (lines.length <= SECTION_MAX) return lines;
  return [...lines.slice(0, SECTION_MAX), `…and ${lines.length - SECTION_MAX} more`];
}

/**
 * Build the digest sections for one person, in reading order: overdue tasks, tasks due
 * today, open issues assigned to them, the portfolio expiry counts and the coverage gaps
 * (admins and managers only — the caller passes null for everyone else), then the
 * unread-inbox count. Returns `null` when there is nothing to say, so the caller can skip
 * the send entirely.
 */
export function composeDigest(input: DigestInput): DigestSection[] | null {
  const overdue = input.tasks.filter((t) => t.due_date < input.today);
  const dueToday = input.tasks.filter((t) => t.due_date === input.today);
  const sections: DigestSection[] = [];
  const taskLine = (t: DigestTask) => `${t.task_name}${t.building_name ? ` — ${t.building_name}` : ''}`;
  const issueLine = (i: DigestIssue) =>
    `${i.title} (${i.priority})${i.building_name ? ` — ${i.building_name}` : ''}`;

  if (overdue.length) {
    sections.push({
      heading: `${overdue.length} overdue ${plural(overdue.length, 'task', 'tasks')}`,
      lines: capLines(overdue.map(taskLine)),
    });
  }
  if (dueToday.length) {
    sections.push({ heading: `${dueToday.length} due today`, lines: capLines(dueToday.map(taskLine)) });
  }
  if (input.issues.length) {
    sections.push({
      heading: `${input.issues.length} open ${plural(input.issues.length, 'issue', 'issues')} assigned to you`,
      lines: capLines(input.issues.map(issueLine)),
    });
  }
  const e = input.expiring;
  if (e && (e.expired || e.d30 || e.d60 || e.d90)) {
    const lines: string[] = [];
    if (e.expired) lines.push(`${e.expired} already expired`);
    if (e.d30) lines.push(`${e.d30} within 30 days`);
    if (e.d60) lines.push(`${e.d60} within 31–60 days`);
    if (e.d90) lines.push(`${e.d90} within 61–90 days`);
    const total = e.expired + e.d30 + e.d60 + e.d90;
    sections.push({ heading: `${total} expiring ${plural(total, 'document, warranty or service', 'documents, warranties and services')}`, lines });
  }
  const c = input.coverage;
  if (c && (c.noTeam.length || c.unassignedOpen || c.silentYesterday.length)) {
    // Both building lists are capped like every other section; the heading carries the true
    // counts so a cap never hides how big the gap is.
    const lines: string[] = capLines(c.noTeam.map((name) => `${name} has no field team`));
    if (c.unassignedOpen) {
      lines.push(`${c.unassignedOpen} open ${plural(c.unassignedOpen, 'task has', 'tasks have')} nobody assigned`);
    }
    lines.push(...capLines(c.silentYesterday.map((name) => `Nothing was logged yesterday at ${name}`)));
    const counts: string[] = [];
    if (c.noTeam.length) {
      counts.push(`${c.noTeam.length} ${plural(c.noTeam.length, 'building', 'buildings')} with no field team`);
    }
    if (c.silentYesterday.length) counts.push(`${c.silentYesterday.length} silent yesterday`);
    sections.push({ heading: counts.length ? `Coverage: ${counts.join(', ')}` : 'Coverage', lines });
  }
  if (input.unread) {
    sections.push({
      heading: `${input.unread} unread ${plural(input.unread, 'notification', 'notifications')}`,
      lines: [],
    });
  }

  return sections.length ? sections : null;
}

/**
 * Most task names a push body quotes. A notification is a glance, not a list: two names say
 * "which ones" and the ellipsis says "and more"; the title carries the true count.
 */
export const PUSH_NAME_MAX = 2;

/**
 * The one `task_due_today` push the digest raises per person: everything they owe as of today
 * (overdue included — it is still due). Returns `null` when nothing is due so the caller sends
 * nothing at all rather than an empty nudge.
 *
 * Title: "N tasks due today" (singular handled). Body: the first two task names joined by ' · ',
 * with ' …' when there are more; when any task is overdue the body leads with the split —
 * "2 overdue · 3 due today — Roof inspection · Generator run-up …" — so the person knows the
 * count includes things already late. `tasks` is expected in due-date order (as the digest
 * query returns it), which puts the oldest overdue names first.
 */
export function dueTodayPush(tasks: DigestTask[], today: string): { title: string; body: string } | null {
  const due = tasks.filter((t) => t.due_date <= today);
  if (!due.length) return null;

  const overdue = due.filter((t) => t.due_date < today).length;
  const dueToday = due.length - overdue;
  const title = `${due.length} ${plural(due.length, 'task', 'tasks')} due today`;

  const names =
    due.slice(0, PUSH_NAME_MAX).map((t) => t.task_name).join(' · ') + (due.length > PUSH_NAME_MAX ? ' …' : '');
  if (!overdue) return { title, body: names };

  // "2 overdue · 3 due today"; a person with only overdue work gets "2 overdue", never "0 due today".
  const split = dueToday ? `${overdue} overdue · ${dueToday} due today` : `${overdue} overdue`;
  return { title, body: `${split} — ${names}` };
}
