import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, AlertTriangle, Users, FileText } from 'lucide-react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useSearchEntities, type SearchHit } from '@/hooks/useSearchEntities';
import { track } from '@/lib/analytics';
import { useRecentSearches } from './useRecentSearches';

const KINDS = ['building', 'issue', 'tenant', 'document'] as const;

const PAGES = [
  { title: 'My Day', href: '/my-day' },
  { title: 'Buildings', href: '/buildings' },
  { title: 'Issues', href: '/issues' },
  { title: 'Checklists', href: '/checklists' },
  { title: 'Inbox', href: '/inbox' },
  { title: 'Profile', href: '/profile' },
];

/** Where a hit lands. Tenants and documents live on their building's tab. */
function hrefFor(hit: SearchHit): string {
  switch (hit.kind) {
    case 'building': return `/buildings/${hit.id}`;
    case 'issue': return `/issues?open=${hit.id}`;
    case 'tenant': return `/buildings/${hit.building_id}?tab=tenants`;
    case 'document': return `/buildings/${hit.building_id}?tab=documents`;
  }
}

function labelFor(kind: SearchHit['kind']): string {
  switch (kind) {
    case 'building': return 'Buildings';
    case 'issue': return 'Issues';
    case 'tenant': return 'Tenants';
    case 'document': return 'Documents';
  }
}

function iconFor(kind: SearchHit['kind']) {
  const cls = 'mr-2 h-4 w-4';
  switch (kind) {
    case 'building': return <Building2 className={cls} />;
    case 'issue': return <AlertTriangle className={cls} />;
    case 'tenant': return <Users className={cls} />;
    case 'document': return <FileText className={cls} />;
  }
}

/**
 * ⌘K search over everything the caller can see (RLS applies in `search_entities`).
 * Results are filtered on the server, so cmdk's own matcher is turned off; only the
 * static Pages group is filtered here.
 */
export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const { data, isFetching } = useSearchEntities(q);
  const { recent, remember } = useRecentSearches();

  const needle = q.trim().toLowerCase();
  const tooShort = needle.length < 2;
  const pages = needle ? PAGES.filter((p) => p.title.toLowerCase().includes(needle)) : PAGES;

  const go = (hit: SearchHit) => {
    remember(hit);
    onOpenChange(false);
    setQ('');
    track('palette_navigate', { kind: hit.kind });
    navigate(hrefFor(hit));
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} shouldFilter={false}>
      <DialogTitle className="sr-only">Search</DialogTitle>
      <DialogDescription className="sr-only">Search buildings, issues, tenants and documents</DialogDescription>
      <CommandInput placeholder="Search buildings, issues, tenants, documents…" value={q} onValueChange={setQ} />
      <CommandList>
        <CommandEmpty>
          {tooShort ? 'Type at least two characters.' : isFetching ? 'Searching…' : 'Nothing matches.'}
        </CommandEmpty>
        {tooShort && recent.length > 0 && (
          <CommandGroup heading="Recent">
            {recent.map((h) => (
              <CommandItem key={`${h.kind}-${h.id}`} value={`${h.kind}-${h.id}`} onSelect={() => go(h)}>
                {iconFor(h.kind)}
                <span className="truncate">{h.title}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {!tooShort && KINDS.map((kind) => {
          const hits = (data ?? []).filter((h) => h.kind === kind);
          if (!hits.length) return null;
          return (
            <CommandGroup key={kind} heading={labelFor(kind)}>
              {hits.map((h) => (
                <CommandItem key={h.id} value={`${h.kind}-${h.id}`} onSelect={() => go(h)}>
                  {iconFor(kind)}
                  <span className="truncate">{h.title}</span>
                  {h.subtitle && <span className="ml-2 truncate text-muted-foreground text-xs">{h.subtitle}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          );
        })}
        {pages.length > 0 && (
          <CommandGroup heading="Pages">
            {pages.map((p) => (
              <CommandItem key={p.href} value={`page-${p.href}`} onSelect={() => { onOpenChange(false); setQ(''); navigate(p.href); }}>
                {p.title}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
