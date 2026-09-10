/**
 * One contractor, in full: details, documents (with expiry) and history (issues, services,
 * ratings). Dialog on desktop, bottom sheet on phones. Editing goes back through the page's
 * `ContractorDialog` so there is one form for create and edit.
 */
import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Mail, Pencil, Phone, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { IssueStatusBadge } from '@/components/ui/status-badge';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/ui/responsive-dialog';
import { ContractorDocuments } from './ContractorDocuments';
import { useContractorHistory, type Contractor } from '@/hooks/useContractors';
import { cn } from '@/lib/utils';
import type { IssueStatus } from '@/lib/constants';

const zar = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 });
const fmtDate = (d: string | null | undefined) => (d ? format(parseISO(d), 'dd MMM yyyy') : '—');

/** Read-only 1–5 stars for an average (`contractors.rating`) or a single rating. */
export function RatingStars({ value, count, className }: { value: number | null | undefined; count?: number; className?: string }) {
  if (value == null) {
    return <span className={cn('text-xs text-muted-foreground', className)}>Not rated</span>;
  }
  const rounded = Math.round(value);
  return (
    <span
      className={cn('inline-flex items-center gap-0.5', className)}
      role="img"
      aria-label={`Rated ${value.toFixed(1)} out of 5${count != null ? ` from ${count} rating${count === 1 ? '' : 's'}` : ''}`}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={cn('h-4 w-4', n <= rounded ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/40')}
          aria-hidden="true"
        />
      ))}
      <span className="ml-1 text-xs text-muted-foreground">{value.toFixed(1)}</span>
    </span>
  );
}

interface ContractorSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contractor: Contractor | null;
  canEdit: boolean;
  onEdit: (contractor: Contractor) => void;
  onSetActive: (contractor: Contractor, active: boolean) => Promise<void>;
}

export function ContractorSheet({ open, onOpenChange, contractor, canEdit, onEdit, onSetActive }: ContractorSheetProps) {
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-2xl">
        {contractor && <SheetBody contractor={contractor} canEdit={canEdit} onEdit={onEdit} onSetActive={onSetActive} />}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm">{children}</dd>
    </div>
  );
}

function SheetBody({
  contractor,
  canEdit,
  onEdit,
  onSetActive,
}: {
  contractor: Contractor;
  canEdit: boolean;
  onEdit: (contractor: Contractor) => void;
  onSetActive: (contractor: Contractor, active: boolean) => Promise<void>;
}) {
  const history = useContractorHistory(contractor.id);
  const [toggling, setToggling] = useState(false);
  const active = contractor.is_active !== false;

  return (
    <div className="flex flex-col gap-5">
      <ResponsiveDialogHeader>
        <div className="flex flex-wrap items-start justify-between gap-2 pr-6">
          <div className="min-w-0">
            <ResponsiveDialogTitle className="truncate">{contractor.company_name}</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              {contractor.trade ?? 'No trade set'}
              {contractor.default_trade_role ? ` · ${contractor.default_trade_role}` : ''}
            </ResponsiveDialogDescription>
          </div>
          <div className="flex items-center gap-2">
            <RatingStars value={contractor.rating} count={history.ratings.length || undefined} />
            {!active && <Badge variant="outline">Inactive</Badge>}
          </div>
        </div>
      </ResponsiveDialogHeader>

      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Detail label="Contact">{contractor.contact_name ?? '—'}</Detail>
        <Detail label="Phone">
          {contractor.contact_phone ? (
            <a href={`tel:${contractor.contact_phone}`} className="inline-flex min-h-11 items-center gap-1 underline-offset-2 hover:underline">
              <Phone className="h-3.5 w-3.5" aria-hidden="true" />{contractor.contact_phone}
            </a>
          ) : '—'}
        </Detail>
        <Detail label="Email">
          {contractor.contact_email ? (
            <a href={`mailto:${contractor.contact_email}`} className="inline-flex min-h-11 items-center gap-1 underline-offset-2 hover:underline">
              <Mail className="h-3.5 w-3.5" aria-hidden="true" />{contractor.contact_email}
            </a>
          ) : '—'}
        </Detail>
        <Detail label="VAT number">{contractor.vat_number ?? '—'}</Detail>
        <div className="sm:col-span-2">
          <dt className="text-xs text-muted-foreground">Address</dt>
          <dd className="whitespace-pre-line text-sm">{contractor.address ?? '—'}</dd>
        </div>
        {contractor.notes && (
          <div className="sm:col-span-2">
            <dt className="text-xs text-muted-foreground">Notes</dt>
            <dd className="whitespace-pre-line text-sm">{contractor.notes}</dd>
          </div>
        )}
      </dl>

      {canEdit && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button type="button" variant="outline" className="min-h-11" onClick={() => onEdit(contractor)}>
            <Pencil className="mr-2 h-4 w-4" />
            Edit details
          </Button>
          <div className="flex min-h-11 items-center gap-2">
            <Label htmlFor="contractor-sheet-active" className="cursor-pointer text-sm">Active</Label>
            <Switch
              id="contractor-sheet-active"
              checked={active}
              disabled={toggling}
              onCheckedChange={async (v) => {
                setToggling(true);
                try { await onSetActive(contractor, v); } finally { setToggling(false); }
              }}
            />
          </div>
        </div>
      )}

      <ContractorDocuments contractorId={contractor.id} canEdit={canEdit} />

      <section aria-labelledby="contractor-history-heading" className="space-y-2">
        <h3 id="contractor-history-heading" className="text-sm font-semibold">History</h3>
        <Tabs defaultValue="issues">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="issues" className="min-h-9">Issues ({history.issues.length})</TabsTrigger>
            <TabsTrigger value="services" className="min-h-9">Services ({history.services.length})</TabsTrigger>
            <TabsTrigger value="ratings" className="min-h-9">Ratings ({history.ratings.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="issues">
            {history.isError && <p className="text-sm text-destructive">Could not load history.</p>}
            {history.issues.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">No issues assigned to this contractor.</p>
            ) : (
              <ul className="divide-y rounded-md border">
                {history.issues.map((i) => (
                  <li key={i.id} className="flex items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{i.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {i.building_name ?? 'Unknown building'} · {fmtDate(i.created_at)}
                        {i.actual_cost != null ? ` · ${zar.format(i.actual_cost)}` : ''}
                      </p>
                    </div>
                    {/* `issues.status` is text in the schema; the badge maps the four known values. */}
                    <IssueStatusBadge status={i.status as IssueStatus} />
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>
          <TabsContent value="services">
            {history.services.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">No asset services recorded for this contractor.</p>
            ) : (
              <ul className="divide-y rounded-md border">
                {history.services.map((s) => (
                  <li key={s.id} className="px-3 py-2">
                    <p className="truncate text-sm font-medium">{s.asset_name ?? 'Asset'}{s.service_type ? ` · ${s.service_type}` : ''}</p>
                    <p className="text-xs text-muted-foreground">
                      {fmtDate(s.service_date)}
                      {s.cost != null ? ` · ${zar.format(s.cost)}` : ''}
                      {s.next_service_date ? ` · next ${fmtDate(s.next_service_date)}` : ''}
                    </p>
                    {s.description && <p className="mt-1 text-xs">{s.description}</p>}
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>
          <TabsContent value="ratings">
            {history.ratings.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">No ratings yet. Ratings are collected when an issue with a contractor is resolved.</p>
            ) : (
              <ul className="divide-y rounded-md border">
                {history.ratings.map((r) => (
                  <li key={r.id} className="px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <RatingStars value={r.rating} />
                      <span className="text-xs text-muted-foreground">{fmtDate(r.created_at)}</span>
                    </div>
                    {r.comment && <p className="mt-1 text-sm">{r.comment}</p>}
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>
        </Tabs>
      </section>
    </div>
  );
}
