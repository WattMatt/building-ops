/**
 * Read-only "who does what here" line on the Checklists tab. Since S1 the rules are edited on
 * the Team tab; this card tells a manager at a glance who catches daily tasks ('user' rule) and
 * issues ('issue' rule — what tenant-intake assigns to), links there, and warns when daily tasks
 * have no owner while work is pending. The warning is a guardrail: plain text, never <Hint>.
 */
import { Link } from 'react-router-dom';
import { AlertTriangle, Users } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { useBuildingMembers, memberDisplayName } from '@/hooks/useBuildingMembers';
import { useBuildingRoleAssignments } from '@/hooks/useBuildingRoleAssignments';

interface RoleAssignmentsPanelProps {
  buildingId: string;
}

/** `user`/`manager` are stored lower-case; template labels are already title-case. */
export function roleLabel(role: string): string {
  if (role === 'user') return 'User (default)';
  if (role === 'manager') return 'Manager';
  return role;
}

export const NO_DAILY_OWNER_WARNING = 'Nobody is assigned to daily tasks here. New tasks land with no owner.';

/** "Daily tasks: Thandi · Issues: Nobody" — the 'user' and 'issue' rules. */
export function summaryLine(rules: Map<string, string>, nameFor: (userId: string) => string): string {
  const who = (role: string) => {
    const id = rules.get(role);
    return id ? nameFor(id) : 'Nobody';
  };
  return `Daily tasks: ${who('user')} · Issues: ${who('issue')}`;
}

export function RoleAssignmentsPanel({ buildingId }: RoleAssignmentsPanelProps) {
  const { isAdminOrManager } = useAuth();
  const { byId } = useBuildingMembers(buildingId);
  const { rules, pendingByRole, isLoading, isError } = useBuildingRoleAssignments(buildingId);

  if (!isAdminOrManager) return null;

  const nameFor = (id: string) => {
    const m = byId.get(id);
    return m ? memberDisplayName(m) : 'Assigned user';
  };
  const pending = [...pendingByRole.values()].reduce((a, b) => a + b, 0);
  const warn = !isLoading && !isError && !rules.has('user') && pending > 0;

  return (
    <Card data-testid="role-assignments-panel">
      <CardContent className="py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          {warn ? (
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-destructive" aria-hidden="true" />
          ) : (
            <Users className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          )}
          <div className="text-sm space-y-1">
            {isLoading ? (
              <span role="status" className="text-muted-foreground">Loading roles…</span>
            ) : isError ? (
              <span className="text-destructive">Could not load the rules for this building.</span>
            ) : (
              <span>{summaryLine(rules, nameFor)}</span>
            )}
            {warn && <p role="alert" className="font-medium text-destructive">{NO_DAILY_OWNER_WARNING}</p>}
          </div>
        </div>
        <Link
          to={`/buildings/${buildingId}?tab=team`}
          className="inline-flex items-center min-h-11 shrink-0 text-sm font-medium underline-offset-4 hover:underline"
        >
          Manage team
        </Link>
      </CardContent>
    </Card>
  );
}

export default RoleAssignmentsPanel;
