import { useReportElectricalCompliance } from '@/integrations/supabase/insight-linker';
import { cocBadgeVariant } from '@/lib/insight-linker-format';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Zap } from 'lucide-react';
import type { SectionProps } from './types';

export default function ElectricalComplianceSection({ buildingId }: SectionProps) {
  const { data, isLoading, isError } = useReportElectricalCompliance(buildingId, true);

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading live COC data from insight-linker…</p>;
  if (isError) return <p className="text-sm text-destructive">Could not load electrical compliance data.</p>;
  if (!data?.linked) return <p className="text-sm text-muted-foreground">This building isn't linked to an insight-linker site.</p>;

  return (
    <div className="space-y-3">
      <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline" className="text-emerald-600 border-emerald-300"><Zap className="mr-1 h-3 w-3" />LIVE · read-only</Badge>
        Live per-shop COC data from insight-linker. Read-only here; the generated PDF captures a snapshot at generation time.
      </p>
      {data.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No shops recorded in insight-linker for this site.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Shop</TableHead><TableHead>Tenant</TableHead><TableHead>COC #</TableHead>
              <TableHead>Type</TableHead><TableHead>Status</TableHead><TableHead>Issued</TableHead><TableHead>Expires</TableHead><TableHead>Certificate</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.rows.map((r, i) => (
              <TableRow key={`${r.shop_number ?? 'shop'}-${i}`}>
                <TableCell className="font-medium">{r.shop_number ?? '—'}</TableCell>
                <TableCell>{r.tenant_name ?? '—'}</TableCell>
                <TableCell>{r.coc_number ?? '—'}</TableCell>
                <TableCell>{r.coc_type ?? '—'}</TableCell>
                <TableCell>{r.coc_status ? <Badge variant={cocBadgeVariant(r.coc_status)}>{r.coc_status}</Badge> : '—'}</TableCell>
                <TableCell>{r.coc_issue_date ?? '—'}</TableCell>
                <TableCell>{r.coc_expiry_date ?? '—'}</TableCell>
                <TableCell>
                  {r.certificate_url
                    ? <a href={r.certificate_url} target="_blank" rel="noopener noreferrer" className="text-primary underline">{r.certificate_name || 'View'}</a>
                    : <span className="text-muted-foreground">—</span>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
