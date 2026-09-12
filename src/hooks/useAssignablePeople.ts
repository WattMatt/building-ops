/**
 * Everyone who holds a role, for the Team tab's "Add person" picker. Served by the
 * `assignable_people` SECURITY DEFINER RPC because `building_members(b)` returns members only
 * and `profiles` RLS does not let a manager enumerate accounts. The RPC raises for anyone who is
 * not an admin or manager, so callers pass `enabled = isAdminOrManager` and never see that error.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface AssignablePerson {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  /** Most privileged role held: admin > manager > user (same precedence as building_members). */
  role: string;
  deactivated: boolean;
}

export const assignablePeopleKey = ['assignable-people'] as const;

/**
 * Who can be ADDED as a field member of a building: not already a member, not an admin or
 * manager (they see every building without a row), and not deactivated (they could not act).
 */
export function addablePeople(people: AssignablePerson[], memberIds: Set<string>): AssignablePerson[] {
  return people.filter((p) => !memberIds.has(p.id) && p.role !== 'admin' && p.role !== 'manager' && !p.deactivated);
}

export function useAssignablePeople(enabled = true) {
  return useQuery({
    queryKey: assignablePeopleKey,
    enabled,
    staleTime: 60 * 1000,
    queryFn: async (): Promise<AssignablePerson[]> => {
      const { data, error } = await supabase.rpc('assignable_people');
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}
