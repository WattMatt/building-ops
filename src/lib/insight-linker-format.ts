type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline';

/** Map a free-text insight-linker COC status to a shadcn Badge variant. */
export function cocBadgeVariant(status: string | null | undefined): BadgeVariant {
  const s = (status ?? '').trim().toLowerCase();
  if (s === 'pass') return 'default';
  if (s === 'fail') return 'destructive';
  if (s === 'pending') return 'secondary';
  return 'outline';
}

/** Human file size; tolerates null (returns ''). */
export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
