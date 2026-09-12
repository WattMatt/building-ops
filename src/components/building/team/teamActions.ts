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

/** Insert the user_buildings row; when asked, make the person the building's 'user' rule. */
export async function addMember(
  buildingId: string,
  userId: string,
  makeDefault: boolean,
  setRule: (role: string, userId: string | null) => Promise<void>,
): Promise<AddOutcome> {
  const { data, error } = await supabase
    .from('user_buildings')
    .insert({ user_id: userId, building_id: buildingId })
    .select('id');
  if (error) return { ok: false, step: 'membership', message: error.message };
  if (!data?.length) return { ok: false, step: 'membership', message: 'no access row was written' };
  if (!makeDefault) return { ok: true };
  try {
    await setRule('user', userId);
  } catch (e) {
    return { ok: false, step: 'default_rule', message: e instanceof Error ? e.message : 'unknown error' };
  }
  return { ok: true };
}

export type RemoveStep = 'rules' | 'tasks' | 'membership';
export interface RemoveOutcome {
  ok: boolean;
  done: RemoveStep[];
  failed?: RemoveStep;
  message?: string;
  tasksUnassigned: number;
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
  const fail = (failed: RemoveStep, message: string): RemoveOutcome => ({ ok: false, done, failed, message, tasksUnassigned });

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

  return { ok: true, done, tasksUnassigned };
}

const STEP_DONE: Record<RemoveStep, (o: RemoveOutcome) => string> = {
  rules: () => 'their rules here were removed',
  tasks: (o) => `${o.tasksUnassigned} task${o.tasksUnassigned === 1 ? ' was' : 's were'} unassigned`,
  membership: () => 'building access was removed',
};
const STEP_NOT_DONE: Record<RemoveStep, string> = {
  rules: 'their rules here were not removed',
  tasks: 'their open tasks were not unassigned',
  membership: 'building access was not removed',
};

/** Plain sentence for the failure toast: what happened, what did, what did not. */
export function describeRemoveOutcome(name: string, o: RemoveOutcome): string {
  if (o.ok) return `Removed ${name} from this building`;
  const steps: RemoveStep[] = ['rules', 'tasks', 'membership'];
  const doneText = o.done.length ? o.done.map((s) => STEP_DONE[s](o)).join(', ') : 'nothing';
  const notDone = steps.filter((s) => !o.done.includes(s)).map((s) => STEP_NOT_DONE[s]).join(', ');
  return `Could not finish removing ${name}: ${o.message}. Done: ${doneText}. Not done: ${notDone}.`;
}
