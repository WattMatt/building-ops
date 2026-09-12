/**
 * The Team tab's writes, kept out of the component so the order and the zero-row checks are
 * unit-tested. Every write chains `.select(...)` and treats zero rows as failure (a policy that
 * silently filters a row returns 200 with nothing). Remove is three steps in a fixed order —
 * rules, open tasks, access — and stops at the first failure; the outcome says which steps ran so
 * the manager is told what was and was not undone.
 */
import { supabase } from '@/integrations/supabase/client';

/** Tasks a leaving member must not keep: not yet done, whether or not already late. */
export const OPEN_STATUSES = ['pending', 'overdue'] as const;

/** Postgres unique_violation — the (building_id, role) primary key already has a row. */
const UNIQUE_VIOLATION = '23505';

export async function countOpenTasksFor(buildingId: string, userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('task_instances')
    .select('id', { count: 'exact', head: true })
    .eq('building_id', buildingId)
    .eq('assigned_to', userId)
    .in('status', [...OPEN_STATUSES]);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export type AddOutcome = { ok: true } | { ok: false; step: 'membership' | 'default_rule'; message: string };

/**
 * Insert the user_buildings row; when asked, make the person the building's 'user' rule.
 * The rule is a plain INSERT, never an upsert: the dialog only offers the default when it saw no
 * 'user' rule, and if one appeared meanwhile (another manager, or a stale view) it must not be
 * overwritten — the unique violation is reported instead.
 */
export async function addMember(buildingId: string, userId: string, makeDefault: boolean): Promise<AddOutcome> {
  const { data, error } = await supabase
    .from('user_buildings')
    .insert({ user_id: userId, building_id: buildingId })
    .select('id');
  if (error) return { ok: false, step: 'membership', message: error.message };
  if (!data?.length) return { ok: false, step: 'membership', message: 'no access row was written' };
  if (!makeDefault) return { ok: true };

  const { data: rule, error: ruleErr } = await supabase
    .from('building_role_assignments')
    .insert({ building_id: buildingId, role: 'user', user_id: userId })
    .select('role');
  if (ruleErr) {
    const message = ruleErr.code === UNIQUE_VIOLATION ? 'someone already holds the daily-task default here' : ruleErr.message;
    return { ok: false, step: 'default_rule', message };
  }
  if (!rule?.length) return { ok: false, step: 'default_rule', message: 'no rule row was written' };
  return { ok: true };
}

export type RemoveStep = 'rules' | 'tasks' | 'membership';
export interface RemoveOutcome {
  ok: boolean;
  done: RemoveStep[];
  failed?: RemoveStep;
  message?: string;
  /** Rows the unassign step actually touched. */
  tasksUnassigned: number;
  /** What the confirm dialog promised; fewer touched than promised is reported, not hidden. */
  expectedOpenTasks: number;
}

/** True when the unassign step ran but touched fewer rows than the dialog showed. */
export function isUnderCount(o: RemoveOutcome): boolean {
  return o.done.includes('tasks') && o.tasksUnassigned < o.expectedOpenTasks;
}

/**
 * @param rulesHeld  role labels whose rule points at this person here (from useBuildingRoleAssignments);
 *                   with none, the rules step has nothing to delete and zero rows is not a failure.
 * @param expectedOpenTasks  what the confirm dialog showed; a zero-row unassign is a failure only
 *                   when the dialog promised tasks.
 */
export async function removeMember(
  buildingId: string,
  userId: string,
  rulesHeld: string[],
  expectedOpenTasks: number,
): Promise<RemoveOutcome> {
  const done: RemoveStep[] = [];
  let tasksUnassigned = 0;
  const fail = (failed: RemoveStep, message: string): RemoveOutcome => ({ ok: false, done, failed, message, tasksUnassigned, expectedOpenTasks });

  if (rulesHeld.length > 0) {
    const { data, error } = await supabase
      .from('building_role_assignments')
      .delete()
      .eq('building_id', buildingId)
      .eq('user_id', userId)
      .select('role');
    if (error) return fail('rules', error.message);
    if (!data?.length) return fail('rules', 'no rule was removed');
  }
  done.push('rules');

  const { data: tasks, error: taskErr } = await supabase
    .from('task_instances')
    .update({ assigned_to: null })
    .eq('building_id', buildingId)
    .eq('assigned_to', userId)
    .in('status', [...OPEN_STATUSES])
    .select('id');
  if (taskErr) return fail('tasks', taskErr.message);
  if (expectedOpenTasks > 0 && !tasks?.length) return fail('tasks', 'no task was unassigned');
  tasksUnassigned = tasks?.length ?? 0;
  done.push('tasks');

  const { data: access, error: accessErr } = await supabase
    .from('user_buildings')
    .delete()
    .eq('building_id', buildingId)
    .eq('user_id', userId)
    .select('id');
  if (accessErr) return fail('membership', accessErr.message);
  if (!access?.length) return fail('membership', 'no access row was removed');
  done.push('membership');

  return { ok: true, done, tasksUnassigned, expectedOpenTasks };
}

const tasksText = (o: RemoveOutcome) =>
  isUnderCount(o)
    ? `${o.tasksUnassigned} of ${o.expectedOpenTasks} open tasks were unassigned`
    : `${o.tasksUnassigned} task${o.tasksUnassigned === 1 ? ' was' : 's were'} unassigned`;

const STEP_DONE: Record<RemoveStep, (o: RemoveOutcome) => string> = {
  rules: () => 'their rules here were removed',
  tasks: tasksText,
  membership: () => 'building access was removed',
};
const STEP_NOT_DONE: Record<RemoveStep, string> = {
  rules: 'their rules here were not removed',
  tasks: 'their open tasks were not unassigned',
  membership: 'building access was not removed',
};

/**
 * Plain sentence for the toast: what happened, what did, what did not. A success that touched
 * fewer tasks than promised says so — the caller shows it as a warning, not a plain success.
 */
export function describeRemoveOutcome(name: string, o: RemoveOutcome): string {
  if (o.ok) {
    return isUnderCount(o)
      ? `Removed ${name} from this building, but only ${tasksText(o)}. Check the open tasks here.`
      : `Removed ${name} from this building`;
  }
  const steps: RemoveStep[] = ['rules', 'tasks', 'membership'];
  const doneText = o.done.length ? o.done.map((s) => STEP_DONE[s](o)).join(', ') : 'nothing';
  const notDone = steps.filter((s) => !o.done.includes(s)).map((s) => STEP_NOT_DONE[s]).join(', ');
  return `Could not finish removing ${name}: ${o.message}. Done: ${doneText}. Not done: ${notDone}.`;
}
