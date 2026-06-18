import { useState, Fragment } from 'react';
import { useBuildingInsightLinker, type ILShop } from '@/integrations/supabase/insight-linker';
import { cocBadgeVariant, formatFileSize } from '@/lib/insight-linker-format';
import { compareShopNumber } from '@/lib/tenantSort';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ChevronRight, ChevronDown, FileText, Link2, Zap } from 'lucide-react';

interface Props { buildingId: string; active: boolean; }

export default function InsightLinkerTab({ buildingId, active }: Props) {
  const { data, isLoading, isError } = useBuildingInsightLinker(buildingId, active);
  const [open, setOpen] = useState<string | null>(null);

  if (isLoading) return <div className="py-12 text-center text-muted-foreground">Loading live data from insight-linker…</div>;
  if (isError) return <div className="py-12 text-center text-destructive">Could not load insight-linker data.</div>;
  if (!data?.linked) return <div className="py-12 text-center text-muted-foreground">This building isn't linked to an insight-linker site.</div>;

  const shops = [...(data.shops ?? [])].sort((a, b) => compareShopNumber(a.name, b.name));
  const roll = data.coc_rollup;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 py-4">
          <Header label="Supply" value={data.site?.supply_authority} />
          <Header label="Max demand" value={data.site?.nominated_max_demand} />
          <Header label="Shops" value={String(data.counts?.shops ?? 0)} />
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Badge variant="outline"><FileText className="mr-1 h-3 w-3" />{roll?.docs ?? 0} docs</Badge>
            {(roll?.pass ?? 0) > 0 && <Badge>{roll!.pass} pass</Badge>}
            {(roll?.fail ?? 0) > 0 && <Badge variant="destructive">{roll!.fail} fail</Badge>}
            {(roll?.pending ?? 0) > 0 && <Badge variant="secondary">{roll!.pending} pending</Badge>}
            <Badge variant="outline" className="text-emerald-600 border-emerald-300"><Zap className="mr-1 h-3 w-3" />LIVE</Badge>
          </div>
        </CardContent>
      </Card>

      {shops.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground">No shops recorded in insight-linker for this site.</div>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Shop</TableHead><TableHead>Tenant</TableHead><TableHead>Category</TableHead>
                <TableHead>Meter S/N</TableHead><TableHead>CT</TableHead><TableHead>COC</TableHead>
                <TableHead className="text-right">Docs</TableHead><TableHead className="text-right">Photos</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shops.map((s) => (
                <Fragment key={s.subsection_id}>
                  <TableRow
                    className="cursor-pointer"
                    tabIndex={0}
                    aria-expanded={open === s.subsection_id}
                    onClick={() => setOpen(open === s.subsection_id ? null : s.subsection_id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(open === s.subsection_id ? null : s.subsection_id); }
                    }}
                  >
                    <TableCell className="font-medium">
                      {open === s.subsection_id ? <ChevronDown className="inline h-4 w-4" aria-hidden="true" /> : <ChevronRight className="inline h-4 w-4" aria-hidden="true" />} {s.name}
                    </TableCell>
                    <TableCell>{s.tenant_name ?? '—'}</TableCell>
                    <TableCell>{s.category ?? '—'}</TableCell>
                    <TableCell>{s.meter_serial_number ?? '—'}</TableCell>
                    <TableCell>{s.ct_ratio ?? '—'}</TableCell>
                    <TableCell>{s.coc.status ? <Badge variant={cocBadgeVariant(s.coc.status)}>{s.coc.status}</Badge> : '—'}</TableCell>
                    <TableCell className="text-right">{s.doc_count}</TableCell>
                    <TableCell className="text-right">{s.photo_count}</TableCell>
                  </TableRow>
                  {open === s.subsection_id && (
                    <TableRow><TableCell colSpan={8} className="bg-muted/40"><ShopDrawer shop={s} /></TableCell></TableRow>
                  )}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {(data.site_documents?.length ?? 0) > 0 && (
        <Card>
          <CardContent className="py-4">
            <p className="mb-2 text-sm font-semibold">Site documents</p>
            <div className="space-y-1">
              {data.site_documents!.map((d, i) => (<DocLink key={d.file_url ?? `site-${i}`} name={d.file_name} url={d.file_url} size={null} />))}
            </div>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">Live from WM Compliance (insight-linker) · read-only · documents &amp; photos open from public buckets.</p>
    </div>
  );
}

function Header({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold">{value ?? '—'}</p>
    </div>
  );
}

function ShopDrawer({ shop }: { shop: ILShop }) {
  return (
    <div className="grid gap-6 py-3 md:grid-cols-2">
      <div className="space-y-3">
        {shop.matched_tenant ? (
          <Badge variant="outline" className="border-dashed">
            <Link2 className="mr-1 h-3 w-3" /> Matched to GMI tenant: {shop.matched_tenant.shop_number} — {shop.matched_tenant.shop_name}
          </Badge>
        ) : (
          <Badge variant="secondary">Unmatched to a GMI tenant</Badge>
        )}
        <div className="grid grid-cols-2 gap-2 text-sm">
          <Field label="COC number" value={shop.coc.number} />
          <Field label="COC type" value={shop.coc.type} />
          <Field label="COC issued" value={shop.coc.issue_date} />
          <Field label="COC expiry" value={shop.coc.expiry} />
          <Field label="Metering status" value={shop.metering_status} />
        </div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Documents</p>
        {shop.documents.length === 0
          ? <p className="text-sm text-muted-foreground">No documents on file.</p>
          : shop.documents.map((d, i) => (<DocLink key={d.file_url ?? `doc-${i}`} name={d.file_name} url={d.file_url} size={d.file_size} badge={d.coc_status ?? d.coc_type ?? undefined} />))}
      </div>
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Photos · by inspection type</p>
        {shop.photos.length === 0
          ? <p className="text-sm text-muted-foreground">No photos on file.</p>
          : <div className="flex flex-wrap gap-3">
              {shop.photos.filter((p) => p.photo_url).map((p) => (
                <a key={p.photo_url!} href={p.photo_url!} target="_blank" rel="noopener noreferrer" className="w-28">
                  <img src={p.photo_url!} alt={p.inspection_title ?? 'photo'} className="h-20 w-28 rounded-md border object-cover" loading="lazy" />
                  <p className="mt-1 truncate text-[10px] text-muted-foreground">{p.inspection_title ?? ''}</p>
                </a>
              ))}
            </div>}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-medium">{value ?? '—'}</p>
    </div>
  );
}

function DocLink({ name, url, size, badge }: { name: string | null; url: string | null; size: number | null; badge?: string }) {
  const cls = 'flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm';
  const inner = (
    <>
      <FileText className="h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
      <span className="flex-1 truncate font-medium">{name || 'Untitled document'}</span>
      {badge && <Badge variant="outline" className="text-[10px]">{badge}</Badge>}
      {size != null && <span className="text-xs text-muted-foreground">{formatFileSize(size)}</span>}
    </>
  );
  return url
    ? <a href={url} target="_blank" rel="noopener noreferrer" className={`${cls} hover:bg-accent`}>{inner}</a>
    : <div className={`${cls} opacity-60`} title="No file URL available">{inner}</div>;
}
