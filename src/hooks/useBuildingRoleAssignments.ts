/**
 * "Who does what here": one person per role label for a building. The nightly generator
 * reads these rules when it sets `task_instances.assigned_to` — the rule whose `role`
 * equals `coalesce(template_items.responsible_party, checklist_templates.responsible_role,
 * 'user')`. This hook owns the rules, the list of labels worth ruling on (from the templates
 * that apply to this building, plus the two fixed defaults), and the one-off "apply to what
 * is already pending" action.
 *
 * Deliberately NOT persisted offline (no PERSIST_DEFAULTS): these are admin/manager settings
 * edited on a desk, not field data a caretaker needs without signal.
 */
import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { templateAppliesToBuilding } from '@/lib/compliance';
import { notify } from '@/lib/notify';

/** Labels every building can rule on, whatever its templates say. Always listed first, in this order. */
export const FIXED_ROLES: readonly string[] = ['user', 'manager'];

/** `user`/`manager` are stored lower-case; template labels are already title-case. */
export function roleLabel(role: string): string {
  if (role === 'user') return 'User (default)';
  if (role === 'manager') return 'Manager';
  return role;
}

interface RuleRow { role: string; user_id: string }

export const buildingRolesKey = (buildingId: string | undefined) => ['building-roles', buildingId] as const;

/** `user` and `manager` first (in that order), then everything else A–Z. */
export function sortRoles(labels: Iterable<string>): string[] {
  const rest = [...new Set(labels)].filter((l) => !FIXED_ROLES.includes(l)).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  return [...FIXED_ROLES, ...rest];
}

interface TemplateRow {
  responsible_role: string | null;
  applies_to_building_types: string[] | null;
  is_active: boolean | null;
  /** Set = archived: the generator skips it, so its labels are not worth ruling on. */
  archived_at?: string | null;
  template_items: { responsible_party: string | null }[] | null;
}

/** The template columns the labels query reads. */
const TEMPLATE_LABEL_COLUMNS = 'responsible_role, applies_to_building_types, is_active, archived_at, template_items(responsible_party)';

/** Distinct labels the generator could stamp on this building's tasks, from the templates that apply to it. */
export function roleLabelsFor(templates: TemplateRow[], buildingType: string | null | undefined): string[] {
  const labels = new Set<string>();
  for (const t of templates) {
    // Mirrors the generator's `where`: inactive and archived templates never produce tasks.
    if (t.is_active === false) continue;
    if (t.archived_at) continue;
    if (!templateAppliesToBuilding(t.applies_to_building_types, buildingType)) continue;
    const fallback = t.responsible_role?.trim() || 'user';
    for (const item of t.template_items ?? []) labels.add(item.responsible_party?.trim() || fallback);
  }
  return sortRoles(labels);
}

export interface BuildingRoleAssignments {
  /** role label → profile id. Only roles with a person present. */
  rules: Map<string, string>;
  /** Every label worth ruling on, `user`/`manager` first. */
  roles: string[];
  /** Unassigned pending tasks per `responsible_role` — what "apply" would touch. */
  pendingByRole: Map<string, number>;
  isLoading: boolean;
  isError: boolean;
  setRule: (role: string, userId: string | null) => Promise<void>;
  /**
   * Assigns every unassigned pending task whose role is listed in `roles` AND has a rule; notifies
   * each person once. Returns the total. Rules on labels no longer offered (an archived template's)
   * are left alone so the count the panel shows and the set this touches agree.
   */
  applyToPending: () => Promise<number>;
}

export function useBuildingRoleAssignments(buildingId: string | undefined): BuildingRoleAssignments {
  const queryClient = useQueryClient();

  const rulesQuery = useQuery({
    queryKey: buildingRolesKey(buildingId),
    enabled: !!buildingId,
    queryFn: async (): Promise<RuleRow[]> => {
      if (!buildingId) return [];
      const { data, error } = await supabase.from('building_role_assignments').select('role, user_id').eq('building_id', buildingId);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  const labelsQuery = useQuery({
    queryKey: [...buildingRolesKey(buildingId), 'labels'],
    enabled: !!buildingId,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<{ roles: string[]; buildingName: string | null }> => {
      if (!buildingId) return { roles: sortRoles([]), buildingName: null };
      const [building, templates] = await Promise.all([
        supabase.from('buildings').select('name, building_type').eq('id', buildingId).maybeSingle(),
        supabase.from('checklist_templates').select(TEMPLATE_LABEL_COLUMNS),
      ]);
      if (building.error) throw new Error(building.error.message);
      if (templates.error) throw new Error(templates.error.message);
      return {
        roles: roleLabelsFor(templates.data ?? [], building.data?.building_type),
        buildingName: building.data?.name ?? null,
      };
    },
  });

  const pendingQuery = useQuery({
    queryKey: [...buildingRolesKey(buildingId), 'pending'],
    enabled: !!buildingId,
    queryFn: async (): Promise<{ responsible_role: string }[]> => {
      if (!buildingId) return [];
      const { data, error } = await supabase
        .from('task_instances')
        .select('responsible_role')
        .eq('building_id', buildingId)
        .eq('status', 'pending')
        .is('assigned_to', null);
      if (error) throw new Error(error.message);
      // Column is nullable in the schema; the generator always writes a label, so treat null as 'user'.
      return (data ?? []).map((t) => ({ responsible_role: t.responsible_role ?? 'user' }));
    },
  });

  const rules = useMemo(() => new Map((rulesQuery.data ?? []).map((r) => [r.role, r.user_id])), [rulesQuery.data]);
  const roles = useMemo(() => labelsQuery.data?.roles ?? sortRoles([]), [labelsQuery.data]);
  const pendingByRole = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of pendingQuery.data ?? []) m.set(t.responsible_role, (m.get(t.responsible_role) ?? 0) + 1);
    return m;
  }, [pendingQuery.data]);

  const setRule = useCallback(async (role: string, userId: string | null) => {
    if (!buildingId) return;
    const table = supabase.from('building_role_assignments');
    const { error } = userId
      ? await table.upsert({ building_id: buildingId, role, user_id: userId }, { onConflict: 'building_id,role' })
      : await table.delete().eq('building_id', buildingId).eq('role', role);
    if (error) throw new Error(error.message);
    await queryClient.invalidateQueries({ queryKey: buildingRolesKey(buildingId), exact: true });
  }, [buildingId, queryClient]);

  const applyToPending = useCallback(async (): Promise<number> => {
    if (!buildingId) return 0;
    // One update per listed rule; the same person may hold several roles, so tally per person before notifying.
    const perPerson = new Map<string, { n: number; firstTaskId: string }>();
    for (const [role, userId] of rules) {
      if (!roles.includes(role)) continue;
      let q = supabase
        .from('task_instances')
        .update({ assigned_to: userId })
        .eq('building_id', buildingId)
        .eq('status', 'pending')
        .is('assigned_to', null);
      // `pendingByRole` reads a null label as 'user'; the update must match the same rows or
      // the count the panel shows and the set this touches disagree.
      q = role === 'user' ? q.or('responsible_role.is.null,responsible_role.eq.user') : q.eq('responsible_role', role);
      const { data, error } = await q.select('id');
      if (error) throw new Error(error.message);
      if (!data?.length) continue;
      const cur = perPerson.get(userId);
      perPerson.set(userId, { n: (cur?.n ?? 0) + data.length, firstTaskId: cur?.firstTaskId ?? data[0].id });
    }
    const buildingName = labelsQuery.data?.buildingName ?? 'a building';
    let total = 0;
    for (const [userId, { n, firstTaskId }] of perPerson) {
      total += n;
      void notify({
        kind: 'task_assigned',
        entityType: 'task',
        entityId: firstTaskId,
        buildingId,
        recipients: [userId],
        title: `${n} task${n === 1 ? '' : 's'} assigned to you at ${buildingName}`,
        url: `/buildings/${buildingId}?tab=checklists`,
      });
    }
    await queryClient.invalidateQueries({ queryKey: buildingRolesKey(buildingId) });
    return total;
  }, [buildingId, rules, roles, labelsQuery.data?.buildingName, queryClient]);

  return {
    rules,
    roles,
    pendingByRole,
    isLoading: rulesQuery.isLoading || labelsQuery.isLoading,
    isError: rulesQuery.isError || labelsQuery.isError,
    setRule,
    applyToPending,
  };
}
