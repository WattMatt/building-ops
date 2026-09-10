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

export interface DigestInput {
  /** Today in the operating timezone, `YYYY-MM-DD`. */
  today: string;
  tasks: DigestTask[];
  issues: DigestIssue[];
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
 * today, open issues assigned to them, then the unread-inbox count. Returns `null` when
 * there is nothing to say, so the caller can skip the send entirely.
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
  if (input.unread) {
    sections.push({
      heading: `${input.unread} unread ${plural(input.unread, 'notification', 'notifications')}`,
      lines: [],
    });
  }

  return sections.length ? sections : null;
}
