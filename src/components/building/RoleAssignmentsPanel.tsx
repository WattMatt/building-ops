/**
 * "Who does what here" — one person per role label for this building. Admin/manager only:
 * the table's RLS rejects writes from anyone else, so the card is not rendered for them.
 * The nightly generator applies these rules to new tasks; "Apply to existing pending tasks"
 * is the one-off catch-up for what is already on the board.
 */
import { useState } from 'react';
import { Loader2, Users, UserCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Hint } from '@/components/ui/hint';
import { AssigneePicker } from '@/components/people/AssigneePicker';
import { useBuildingMembers, memberDisplayName } from '@/hooks/useBuildingMembers';
import { useBuildingRoleAssignments } from '@/hooks/useBuildingRoleAssignments';

interface RoleAssignmentsPanelProps {
  buildingId: string;
  buildingName?: string;
  /** Called after "apply" assigned at least one task, so the owner can refetch its task list. */
  onApplied?: (count: number) => void;
}

/** `user`/`manager` are stored lower-case; template labels are already title-case. */
export function roleLabel(role: string): string {
  if (role === 'user') return 'User (default)';
  if (role === 'manager') return 'Manager';
  return role;
}

const idFor = (role: string) => `role-rule-${role.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

export function RoleAssignmentsPanel({ buildingId, buildingName, onApplied }: RoleAssignmentsPanelProps) {
  const { isAdminOrManager } = useAuth();
  const { byId } = useBuildingMembers(buildingId);
  const { rules, roles, pendingByRole, isLoading, isError, setRule, applyToPending } = useBuildingRoleAssignments(buildingId);
  const [applying, setApplying] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  if (!isAdminOrManager) return null;

  const applicable = roles.reduce((n, role) => n + (rules.has(role) ? pendingByRole.get(role) ?? 0 : 0), 0);

  const handleSet = async (role: string, userId: string | null) => {
    setSaving(role);
    try {
      await setRule(role, userId);
      const member = userId ? byId.get(userId) : undefined;
      toast.success(userId ? `${roleLabel(role)}: ${member ? memberDisplayName(member) : 'assigned'}` : `${roleLabel(role)}: nobody`);
    } catch (e) {
      toast.error(`Could not save the rule: ${e instanceof Error ? e.message : 'unknown error'}`);
    } finally {
      setSaving(null);
    }
  };

  const handleApply = async () => {
    setApplying(true);
    try {
      const n = await applyToPending();
      if (n > 0) {
        toast.success(`Assigned ${n} pending task${n === 1 ? '' : 's'} at ${buildingName ?? 'this building'}`);
        onApplied?.(n);
      } else {
        toast.info('No unassigned pending tasks match these rules');
      }
    } catch (e) {
      toast.error(`Could not apply the rules: ${e instanceof Error ? e.message : 'unknown error'}`);
    } finally {
      setApplying(false);
    }
  };

  return (
    <Card data-testid="role-assignments-panel">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="h-4 w-4" aria-hidden="true" />
          Who does what here
        </CardTitle>
        <Hint>New tasks are assigned automatically from these rules every night.</Hint>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading roles…
          </div>
        ) : (
          <>
            {isError && <p className="text-sm text-destructive">Could not load the rules for this building.</p>}
            <ul className="space-y-3">
              {roles.map((role) => (
                <li key={role} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                  <Label htmlFor={idFor(role)} className="text-sm font-medium sm:w-44 sm:shrink-0">
                    {roleLabel(role)}
                  </Label>
                  {/* The picker's trigger is 40 px by default; lift it to the 44 px touch target. */}
                  <AssigneePicker
                    id={idFor(role)}
                    buildingId={buildingId}
                    value={rules.get(role) ?? null}
                    onChange={(id) => handleSet(role, id)}
                    disabled={saving === role}
                    placeholder="Nobody"
                    className="flex-1 [&_[role=combobox]]:min-h-11"
                  />
                </li>
              ))}
            </ul>
            <Button
              variant="secondary"
              onClick={handleApply}
              disabled={applying || applicable === 0}
              className="min-h-11 w-full sm:w-auto"
            >
              {applying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <UserCheck className="mr-2 h-4 w-4" aria-hidden="true" />}
              Apply to existing pending tasks ({applicable})
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default RoleAssignmentsPanel;
