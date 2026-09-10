import { useMatch, useNavigate } from 'react-router-dom';
import { Plus, AlertTriangle, PenLine, ClipboardCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/contexts/AuthContext';
import { track } from '@/lib/analytics';

/**
 * The "+" in the top bar. Context-aware: on a building page the new issue is pre-scoped
 * to that building and the building-only actions (note, generate tasks) appear.
 */
export function QuickCreateMenu() {
  const navigate = useNavigate();
  const { isAdminOrManager } = useAuth();
  const match = useMatch('/buildings/:id');
  const buildingId = match?.params.id;

  const go = (kind: 'issue' | 'note' | 'tasks', href: string) => {
    track('quick_create', { kind });
    navigate(href);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Create" className="h-11 w-11 sm:h-9 sm:w-9">
          <Plus className="h-5 w-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          className="min-h-11 sm:min-h-0"
          onSelect={() => go('issue', `/issues/new${buildingId ? `?building=${buildingId}` : ''}`)}
        >
          <AlertTriangle className="mr-2 h-4 w-4" />
          New issue
        </DropdownMenuItem>
        {buildingId && (
          <DropdownMenuItem className="min-h-11 sm:min-h-0" onSelect={() => go('note', `/buildings/${buildingId}?tab=notes`)}>
            <PenLine className="mr-2 h-4 w-4" />
            New note
          </DropdownMenuItem>
        )}
        {buildingId && isAdminOrManager && (
          <DropdownMenuItem className="min-h-11 sm:min-h-0" onSelect={() => go('tasks', `/buildings/${buildingId}?tab=checklists`)}>
            <ClipboardCheck className="mr-2 h-4 w-4" />
            Generate tasks
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
