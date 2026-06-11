import { differenceInCalendarDays, parseISO } from 'date-fns';

export interface HsTask {
  id: string;
  task_name: string;
  category: string | null;
  status: string;
  due_date: string;
  completed_at: string | null;
  completed_by_name: string | null;
  completion_notes: string | null;
  photo_urls: string[];
  signature_confirmed: boolean;
}

export interface HsDocument {
  id: string;
  name: string;
  document_type: string;
  expiry_date: string | null;
  issuing_authority: string | null;
  reference_number: string | null;
}

export interface CategorySummary {
  category: string;
  completed: number;
  outstanding: number;
  overdue: number;
}

export interface CertStatus {
  status: 'expired' | 'expiring_soon' | 'current' | 'no_expiry';
  daysRemaining: number | null;
}

export interface HsReportData {
  summary: CategorySummary[];
  completedTasks: HsTask[];
  outstandingTasks: HsTask[];
}

export function certificateStatus(doc: HsDocument, today: Date): CertStatus {
  if (!doc.expiry_date) return { status: 'no_expiry', daysRemaining: null };
  const days = differenceInCalendarDays(parseISO(doc.expiry_date), today);
  if (days < 0) return { status: 'expired', daysRemaining: days };
  if (days <= 60) return { status: 'expiring_soon', daysRemaining: days };
  return { status: 'current', daysRemaining: days };
}

export function assembleHsReportData(tasks: HsTask[], _documents: HsDocument[], today: Date): HsReportData {
  const byCategory = new Map<string, CategorySummary>();
  const todayStr = today.toISOString().slice(0, 10);
  const completedTasks: HsTask[] = [];
  const outstandingTasks: HsTask[] = [];

  for (const task of tasks) {
    const cat = task.category ?? 'uncategorised';
    const row = byCategory.get(cat) ?? { category: cat, completed: 0, outstanding: 0, overdue: 0 };
    if (task.status === 'completed') {
      row.completed += 1;
      completedTasks.push(task);
    } else {
      row.outstanding += 1;
      if (task.due_date < todayStr) row.overdue += 1;
      outstandingTasks.push(task);
    }
    byCategory.set(cat, row);
  }

  completedTasks.sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''));
  outstandingTasks.sort((a, b) => a.due_date.localeCompare(b.due_date));

  return {
    summary: [...byCategory.values()].sort((a, b) => a.category.localeCompare(b.category)),
    completedTasks,
    outstandingTasks,
  };
}
