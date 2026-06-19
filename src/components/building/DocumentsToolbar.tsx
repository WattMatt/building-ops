import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, Plus } from 'lucide-react';
import type { DocFilters, GroupBy } from './documents/filterDocuments';
import type { UnifiedDocument } from './documents/types';

interface Props {
  query: string;
  onQuery: (v: string) => void;
  filters: DocFilters;
  onFilters: (f: DocFilters) => void;
  groupBy: GroupBy;
  onGroupBy: (g: GroupBy) => void;
  docs: UnifiedDocument[]; // unfiltered, for building filter option lists
  canAdd: boolean;
  onAdd: () => void;
}

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'danger', label: 'Expired / failed' },
  { value: 'warning', label: 'Expiring / pending' },
  { value: 'success', label: 'Valid / passed' },
  { value: 'neutral', label: 'No status' },
] as const;

export default function DocumentsToolbar({
  query,
  onQuery,
  filters,
  onFilters,
  groupBy,
  onGroupBy,
  docs,
  canAdd,
  onAdd,
}: Props) {
  const types = Array.from(new Map(docs.map((d) => [d.typeValue, d.type])).entries()).sort((a, b) =>
    a[1].localeCompare(b[1]),
  );
  const shops = Array.from(new Set(docs.map((d) => d.shopNumber).filter((s): s is string => !!s))).sort(
    (a, b) => a.localeCompare(b, undefined, { numeric: true }),
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative flex-1 min-w-[180px]">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search name, type, shop…"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
        />
      </div>

      <Select
        value={filters.source}
        onValueChange={(v) => onFilters({ ...filters, source: v as DocFilters['source'] })}
      >
        <SelectTrigger className="w-[150px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All sources</SelectItem>
          <SelectItem value="managed">Managed</SelectItem>
          <SelectItem value="insight_linker">Insight-linker</SelectItem>
        </SelectContent>
      </Select>

      <Select value={filters.type} onValueChange={(v) => onFilters({ ...filters, type: v })}>
        <SelectTrigger className="w-[160px]">
          <SelectValue placeholder="All types" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All types</SelectItem>
          {types.map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.status}
        onValueChange={(v) => onFilters({ ...filters, status: v as DocFilters['status'] })}
      >
        <SelectTrigger className="w-[160px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STATUS_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {shops.length > 0 && (
        <Select value={filters.shop} onValueChange={(v) => onFilters({ ...filters, shop: v })}>
          <SelectTrigger className="w-[130px]">
            <SelectValue placeholder="All shops" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All shops</SelectItem>
            {shops.map((s) => (
              <SelectItem key={s} value={s}>
                Shop {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <div className="flex items-center gap-1">
        <span className="text-sm text-muted-foreground">Organise by</span>
        <Select value={groupBy} onValueChange={(v) => onGroupBy(v as GroupBy)}>
          <SelectTrigger className="w-[175px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="section">Section → category</SelectItem>
            <SelectItem value="type">Category</SelectItem>
            <SelectItem value="source">Source</SelectItem>
            <SelectItem value="status">Status</SelectItem>
            <SelectItem value="none">Nothing</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {canAdd && (
        <Button onClick={onAdd}>
          <Plus className="h-4 w-4 mr-1" /> Add
        </Button>
      )}
    </div>
  );
}
