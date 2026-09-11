/**
 * "Evidence pack" for one issue, one task or one asset (R4b, spec §5.9): the PDF an insurer,
 * a landlord or an inspector gets when they ask you to prove what happened — optionally zipped
 * with the original photos.
 *
 * Every signed-in viewer who can see the subject may export it: RLS already decides what they
 * can read, and a pack contains nothing they are not already looking at.
 */
import { useState } from 'react';
import { FileDown, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/contexts/AuthContext';
import { useOrganization } from '@/hooks/useOrganization';
import { useUserProfile } from '@/hooks/useUserProfile';
import { FALLBACK_PRIMARY } from '@/lib/reportDocs';
import { downloadEvidencePack } from '@/lib/evidencePackExport';
import type { PackMeta } from '@/lib/evidencePack';

export type EvidencePackKind = 'issue' | 'task' | 'asset';

export interface EvidencePackProps {
  kind: EvidencePackKind;
  id: string;
  buildingName: string;
  disabled?: boolean;
}

/** Which variant is building, or null when idle — drives the spinner on the item that was clicked. */
type Busy = 'pdf' | 'zip' | null;

function useEvidencePackRunner(kind: EvidencePackKind, id: string, buildingName: string) {
  const { organization } = useOrganization();
  const { profile } = useUserProfile();
  const { user } = useAuth();
  const [busy, setBusy] = useState<Busy>(null);

  const run = async (withOriginals: boolean) => {
    if (busy) return;
    setBusy(withOriginals ? 'zip' : 'pdf');
    const meta: PackMeta = {
      orgName: organization?.name ?? 'Fortress',
      primaryColor: organization?.primary_color ?? FALLBACK_PRIMARY,
      generatedAt: new Intl.DateTimeFormat('en-ZA', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Africa/Johannesburg',
      }).format(new Date()),
      generatedBy: profile?.full_name?.trim() || profile?.email || user?.email || 'Unknown',
      buildingName,
    };
    try {
      await downloadEvidencePack(kind, id, meta, { withOriginals });
    } catch (err) {
      toast.error('Could not build the evidence pack. ' + (err instanceof Error ? err.message : 'Please try again.'));
    } finally {
      setBusy(null);
    }
  };

  return { busy, run };
}

/**
 * The two menu items on their own, for a surface that already owns a dropdown (the asset row
 * menu). A component rather than a plain function because it holds the runner's state —
 * the plan sketched it as `evidencePackItems(...)`.
 */
export function EvidencePackItems({ kind, id, buildingName, disabled }: EvidencePackProps) {
  const { busy, run } = useEvidencePackRunner(kind, id, buildingName);
  return (
    <>
      <DropdownMenuItem
        className="min-h-11"
        disabled={disabled || busy !== null}
        onSelect={(e) => {
          e.preventDefault();
          void run(false);
        }}
      >
        {busy === 'pdf' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileDown className="mr-2 h-4 w-4" />}
        PDF
      </DropdownMenuItem>
      <DropdownMenuItem
        className="min-h-11"
        disabled={disabled || busy !== null}
        onSelect={(e) => {
          e.preventDefault();
          void run(true);
        }}
      >
        {busy === 'zip' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileDown className="mr-2 h-4 w-4" />}
        PDF + original photos (zip)
      </DropdownMenuItem>
    </>
  );
}

export function EvidencePackMenu({ kind, id, buildingName, disabled }: EvidencePackProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="min-h-11" disabled={disabled}>
          <FileDown className="mr-2 h-4 w-4" />
          Evidence pack
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <EvidencePackItems kind={kind} id={id} buildingName={buildingName} disabled={disabled} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default EvidencePackMenu;
