/**
 * Portfolio-wide expiry alerts for admins and managers: building, tenant and contractor documents,
 * asset warranties and service dates, read in one go through `useExpiringItems` (the
 * `expiring_items()` RPC — security invoker, so RLS scopes what each caller sees). Bucket pills
 * narrow the list to expired / ≤ 30 / 31–60 / 61–90 days; the two tabs split documents-and-
 * warranties from service dates, as they always did.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Building2, FileWarning, Loader2, Wrench } from 'lucide-react';
import { formatBuildingName } from '@/lib/buildingName';
import { useExpiringItems } from '@/hooks/useExpiringItems';
import { BUCKETS, BUCKET_LABELS, KIND_LABELS, bucketOf, countBuckets, expiryPhrase, itemUrl, type ExpiringItem, type ExpiryBucket } from '@/lib/expiry';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

const SHOW = 5;

function ExpiryBadge({ item }: { item: ExpiringItem }) {
  const n = item.days_left;
  if (n < 0) return <Badge variant="destructive">{item.kind === 'asset_service' ? `${-n}d overdue` : 'Expired'}</Badge>;
  if (n <= 7) return <Badge className="bg-destructive/80 text-destructive-foreground">{n}d</Badge>;
  if (n <= 30) return <Badge className="bg-warning text-warning-foreground">{n}d</Badge>;
  return <Badge variant="secondary">{n}d</Badge>;
}

function Row({ item }: { item: ExpiringItem }) {
  const Icon = item.entity_type === 'asset' ? Wrench : FileWarning;
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border bg-card p-3">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', item.days_left < 0 ? 'text-destructive' : 'text-warning')} />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{item.name}</p>
          <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            {item.building_name && (<><Building2 className="h-3 w-3" /><span className="truncate">{formatBuildingName(item.building_name)}</span><span>•</span></>)}
            <span>{KIND_LABELS[item.kind]}{item.detail ? ` · ${item.detail}` : ''}</span>
            <span>•</span>
            <span>{expiryPhrase(item)}</span>
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <ExpiryBadge item={item} />
        <Button variant="ghost" size="icon" className="h-11 w-11" asChild>
          <Link to={itemUrl(item)} aria-label={`Open ${item.name}`}><ArrowRight className="h-4 w-4" /></Link>
        </Button>
      </div>
    </div>
  );
}

function List({ items, empty }: { items: ExpiringItem[]; empty: string }) {
  if (!items.length) return <p className="py-4 text-center text-sm text-muted-foreground">{empty}</p>;
  return (
    <>
      {items.slice(0, SHOW).map((i) => <Row key={`${i.kind}-${i.entity_id}`} item={i} />)}
      {items.length > SHOW && <p className="pt-2 text-center text-xs text-muted-foreground">+{items.length - SHOW} more</p>}
    </>
  );
}

export default function GlobalAlertsWidget() {
  const query = useExpiringItems(90);
  const [bucket, setBucket] = useState<ExpiryBucket | 'all'>('all');
  const items = useMemo(() => query.data ?? [], [query.data]);
  const counts = useMemo(() => countBuckets(items), [items]);
  const visible = useMemo(() => (bucket === 'all' ? items : items.filter((i) => bucketOf(i.days_left) === bucket)), [items, bucket]);
  const documents = visible.filter((i) => i.entity_type === 'document' || i.kind === 'asset_warranty');
  const maintenance = visible.filter((i) => i.kind === 'asset_service');

  if (query.isLoading) {
    return <Card><CardContent className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></CardContent></Card>;
  }
  if (query.isError) {
    return (
      <Card className="border-destructive/50">
        <CardHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <div><CardTitle>Global Alerts</CardTitle><CardDescription>Alerts could not be checked</CardDescription></div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <p className="mb-1 text-sm font-medium">Failed to load global alerts</p>
            <p className="mb-4 max-w-sm text-xs text-muted-foreground">{(query.error as Error)?.message} Expiring documents and overdue maintenance across the portfolio are not visible right now.</p>
            <Button onClick={() => void query.refetch()} variant="outline" className="h-11">Try Again</Button>
          </div>
        </CardContent>
      </Card>
    );
  }
  if (items.length === 0) return null;

  return (
    <Card className="border-warning/50 bg-warning/5">
      <CardHeader>
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-warning" />
          <div>
            <CardTitle>Global Alerts</CardTitle>
            <CardDescription>{items.length} item{items.length === 1 ? '' : 's'} expiring within 90 days or already past</CardDescription>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Expiry window">
          <Button variant={bucket === 'all' ? 'default' : 'outline'} size="sm" className="h-11" aria-pressed={bucket === 'all'} onClick={() => setBucket('all')}>All ({items.length})</Button>
          {BUCKETS.map((b) => (
            <Button key={b} variant={bucket === b ? 'default' : 'outline'} size="sm" className="h-11" aria-pressed={bucket === b} onClick={() => setBucket(b)}>
              {BUCKET_LABELS[b]} ({counts[b]})
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="documents" className="w-full">
          <TabsList className="mb-4 grid w-full grid-cols-2">
            <TabsTrigger value="documents" className="h-11 gap-2"><FileWarning className="h-4 w-4" />Documents ({documents.length})</TabsTrigger>
            <TabsTrigger value="maintenance" className="h-11 gap-2"><Wrench className="h-4 w-4" />Maintenance ({maintenance.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="documents" className="space-y-3"><List items={documents} empty="No expiring documents or warranties in this window" /></TabsContent>
          <TabsContent value="maintenance" className="space-y-3"><List items={maintenance} empty="No service dates in this window" /></TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
