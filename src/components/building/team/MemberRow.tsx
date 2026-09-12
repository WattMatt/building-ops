/** One field member: avatar, name, a chip per role label (filled when the rule points at them), Remove. */
import { UserMinus } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { memberDisplayName, type BuildingMember } from '@/hooks/useBuildingMembers';
import { roleLabel } from '@/hooks/useBuildingRoleAssignments';

interface MemberRowProps {
  member: BuildingMember;
  /** Every label worth ruling on at this building (`useBuildingRoleAssignments().roles`). */
  roles: string[];
  /** role label → profile id (`useBuildingRoleAssignments().rules`). */
  rules: Map<string, string>;
  /** The role whose rule is being written right now, if any. */
  busyRole: string | null;
  onToggleRule: (role: string, held: boolean) => void;
  onRemove: () => void;
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
}

export function MemberRow({ member, roles, rules, busyRole, onToggleRule, onRemove }: MemberRowProps) {
  const name = memberDisplayName(member);
  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:gap-4" data-testid={`member-${member.id}`}>
      <div className="flex items-center gap-3 sm:w-56 sm:shrink-0">
        <Avatar className="h-9 w-9">
          {member.avatar_url && <AvatarImage src={member.avatar_url} alt="" />}
          <AvatarFallback>{initials(name)}</AvatarFallback>
        </Avatar>
        <p className="font-medium text-sm truncate">{name}</p>
      </div>
      <div className="flex flex-wrap gap-2 flex-1" role="group" aria-label={`Roles for ${name}`}>
        {roles.map((role) => {
          const held = rules.get(role) === member.id;
          return (
            <Button
              key={role}
              type="button"
              size="sm"
              variant={held ? 'default' : 'outline'}
              aria-pressed={held}
              disabled={busyRole !== null}
              onClick={() => onToggleRule(role, held)}
              className="min-h-11 rounded-full"
            >
              {roleLabel(role)}
            </Button>
          );
        })}
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={onRemove} aria-label={`Remove ${name}`} className="min-h-11 self-start text-destructive">
        <UserMinus className="h-4 w-4 mr-2" aria-hidden="true" />
        Remove
      </Button>
    </li>
  );
}
