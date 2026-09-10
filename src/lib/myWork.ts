/** Pure helpers for the My Day page: bucketing by due date and the greeting line. */
export interface MyTask {
  id: string; task_name: string; task_description: string | null; due_date: string;
  building_id: string; building_name: string; requires_photo: boolean; requires_signature: boolean;
  status: 'pending' | 'overdue';
}
export interface TaskBuckets { overdue: MyTask[]; today: MyTask[]; upcoming: MyTask[] }

const UPCOMING_DAYS = 7;

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** `today` is YYYY-MM-DD in the operating timezone; due_date is a date column (YYYY-MM-DD). */
export function bucketTasks(tasks: MyTask[], today: string): TaskBuckets {
  const horizon = addDays(today, UPCOMING_DAYS);
  const sorted = [...tasks].sort((a, b) => a.due_date.localeCompare(b.due_date));
  return {
    overdue: sorted.filter((t) => t.due_date < today),
    today: sorted.filter((t) => t.due_date === today),
    upcoming: sorted.filter((t) => t.due_date > today && t.due_date <= horizon),
  };
}

export function greetingFor(fullName: string | null | undefined, hour: number): string {
  const part = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const first = fullName?.trim().split(/\s+/)[0];
  return first ? `${part}, ${first}` : part;
}

/** Today as YYYY-MM-DD in the operating timezone (South Africa has no DST). */
export function todayInOperatingTz(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
