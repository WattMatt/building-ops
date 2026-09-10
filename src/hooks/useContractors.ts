/**
 * The contractor register (spec §8, R3c). Three hooks:
 *
 * - `useContractors()` — the whole register, inactive rows included (the page filters). Reads
 *   are org-wide (`c_select` = any authenticated user, which is why `ContractorPicker` can use
 *   it from an issue or a service-history dialog); writes are admin/manager under RLS. Every
 *   write ends in `.select('id')`: a silently filtered-out update comes back as zero rows, and
 *   zero rows is reported as a permission problem instead of a phantom success.
 * - `useContractorDocuments(contractorId)` — files under `contractor-docs/<contractorId>/` in
 *   the private `tenant-documents` bucket (storage policies: read and write admin/manager only).
 *   `file_url` stores the object PATH; `contractorDocumentUrl` turns it into the public-URL form
 *   that `openStorageFile` re-signs, so older rows saved as URLs keep working too.
 * - `useContractorHistory(contractorId)` — everything the register has done: issues assigned
 *   to it, asset services it performed, and the ratings it received on resolve.
 *
 * `contractors.address/vat_number/default_trade_role`, `contractor_documents.notes` and the
 * `contractor_ratings` table are not yet in the generated types; regenerate after the migration
 * ships and drop the casts marked below.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { openStorageFile } from '@/integrations/supabase/storage';
import type { Tables } from '@/integrations/supabase/types';

export const CONTRACTORS_KEY = ['contractors'] as const;
export const CONTRACTOR_DOCUMENTS_KEY = (contractorId: string) => ['contractor-documents', contractorId] as const;
export const CONTRACTOR_HISTORY_KEY = (contractorId: string) => ['contractor-history', contractorId] as const;

export const CONTRACTOR_DOCS_BUCKET = 'tenant-documents';
/** Required by the storage policies `td read contractor docs` / `td write contractor docs`. */
export const CONTRACTOR_DOCS_PREFIX = 'contractor-docs';

/** Plain guardrail copy for a write that RLS filtered to nothing. */
export const CONTRACTOR_PERMISSION_MESSAGE = 'Only admins and managers can change the contractor register.';

// address, vat_number and default_trade_role are not yet in the generated types; regenerate after the migration ships.
export type Contractor = Tables<'contractors'> & {
  address: string | null;
  vat_number: string | null;
  default_trade_role: string | null;
};

/** What the dialog collects. Everything but the company name is optional. */
export interface ContractorInput {
  company_name: string;
  trade: string | null;
  default_trade_role: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  address: string | null;
  vat_number: string | null;
  notes: string | null;
  is_active: boolean;
}

// notes is not yet in the generated types; regenerate after the migration ships.
export type ContractorDocument = Tables<'contractor_documents'> & { notes: string | null };

export interface ContractorDocumentMeta {
  document_name: string;
  document_type: string;
  expiry_date: string | null;
  notes?: string | null;
}

// contractor_ratings is not yet in the generated types; regenerate after the migration ships.
export interface ContractorRating {
  id: string;
  contractor_id: string;
  issue_id: string | null;
  rating: number;
  comment: string | null;
  rated_by: string | null;
  created_at: string;
}

export interface ContractorIssue {
  id: string;
  title: string;
  status: string;
  priority: string;
  created_at: string | null;
  resolved_at: string | null;
  actual_cost: number | null;
  building_id: string;
  building_name: string | null;
}

export interface ContractorService {
  id: string;
  service_date: string;
  service_type: string | null;
  description: string | null;
  cost: number | null;
  next_service_date: string | null;
  asset_id: string;
  asset_name: string | null;
  building_id: string | null;
}

/** A joined `buildings(name)` comes back as an object, or null when the row has no building. */
type JoinedBuilding = { name: string | null } | null;
type RawIssue = Omit<ContractorIssue, 'building_name'> & { buildings: JoinedBuilding };
type JoinedAsset = { name: string | null; building_id: string } | null;
type RawService = Omit<ContractorService, 'asset_name' | 'building_id'> & { building_assets: JoinedAsset };

/** `.select('id')` after a write: zero rows means RLS filtered the row away, not that it worked. */
function assertWrote(rows: { id: string }[] | null, error: { message: string } | null): string {
  if (error) throw new Error(error.message);
  if (!rows || rows.length === 0) throw new Error(CONTRACTOR_PERMISSION_MESSAGE);
  return rows[0].id;
}

export function useContractors() {
  const qc = useQueryClient();

  const list = useQuery({
    queryKey: CONTRACTORS_KEY,
    queryFn: async (): Promise<Contractor[]> => {
      const { data, error } = await supabase
        .from('contractors')
        .select('*')
        .order('company_name', { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as Contractor[];
    },
    staleTime: 5 * 60_000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: CONTRACTORS_KEY });

  const create = useMutation({
    mutationFn: async (input: ContractorInput): Promise<string> => {
      const { data, error } = await supabase.from('contractors').insert(input).select('id');
      return assertWrote(data, error);
    },
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: async ({ id, ...input }: ContractorInput & { id: string }): Promise<string> => {
      const { data, error } = await supabase.from('contractors').update(input).eq('id', id).select('id');
      return assertWrote(data, error);
    },
    onSuccess: invalidate,
  });

  const setActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }): Promise<string> => {
      const { data, error } = await supabase.from('contractors').update({ is_active }).eq('id', id).select('id');
      return assertWrote(data, error);
    },
    onSuccess: invalidate,
  });

  return {
    contractors: list.data ?? [],
    isLoading: list.isLoading,
    isError: list.isError,
    error: list.error,
    refetch: list.refetch,
    create,
    update,
    setActive,
  };
}

/** Object key inside the bucket, from either the stored path or the older public-URL form. */
export function contractorDocumentKey(fileUrl: string | null | undefined): string | null {
  if (!fileUrl) return null;
  const marker = `/${CONTRACTOR_DOCS_BUCKET}/`;
  const at = fileUrl.indexOf(marker);
  if (at >= 0) return decodeURIComponent(fileUrl.slice(at + marker.length));
  return fileUrl;
}

/** The public-URL form `resolveStorageUrl`/`openStorageFile` know how to re-sign. */
export function contractorDocumentUrl(fileUrl: string | null | undefined): string | null {
  const key = contractorDocumentKey(fileUrl);
  if (!key) return null;
  return supabase.storage.from(CONTRACTOR_DOCS_BUCKET).getPublicUrl(key).data.publicUrl;
}

/** Open a contractor document in a new tab through a fresh signed URL. */
export async function openContractorDocument(fileUrl: string | null | undefined): Promise<void> {
  await openStorageFile(contractorDocumentUrl(fileUrl));
}

function fileExtension(file: File): string {
  const fromName = file.name.includes('.') ? file.name.split('.').pop() : '';
  return (fromName || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
}

export function useContractorDocuments(contractorId: string | null | undefined) {
  const qc = useQueryClient();
  const key = CONTRACTOR_DOCUMENTS_KEY(contractorId ?? '');

  const list = useQuery({
    queryKey: key,
    queryFn: async (): Promise<ContractorDocument[]> => {
      const { data, error } = await supabase
        .from('contractor_documents')
        .select('*')
        .eq('contractor_id', contractorId!)
        .order('uploaded_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as ContractorDocument[];
    },
    enabled: !!contractorId,
    staleTime: 60_000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: key });

  const upload = useMutation({
    mutationFn: async ({ file, meta }: { file: File; meta: ContractorDocumentMeta }): Promise<string> => {
      if (!contractorId) throw new Error('Pick a contractor first.');
      const path = `${CONTRACTOR_DOCS_PREFIX}/${contractorId}/${crypto.randomUUID()}.${fileExtension(file)}`;
      const { error: uploadError } = await supabase.storage
        .from(CONTRACTOR_DOCS_BUCKET)
        .upload(path, file, { contentType: file.type || 'application/octet-stream' });
      if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);
      const row = {
        contractor_id: contractorId,
        document_name: meta.document_name,
        document_type: meta.document_type,
        expiry_date: meta.expiry_date,
        notes: meta.notes ?? null,
        file_url: path,
      };
      const { data, error } = await supabase.from('contractor_documents').insert(row).select('id');
      if (error || !data || data.length === 0) {
        // Do not leave an orphan object behind a row that never existed.
        await supabase.storage.from(CONTRACTOR_DOCS_BUCKET).remove([path]);
      }
      return assertWrote(data, error);
    },
    onSuccess: invalidate,
  });

  const setVerified = useMutation({
    mutationFn: async ({ id, is_verified }: { id: string; is_verified: boolean }): Promise<string> => {
      const { data, error } = await supabase
        .from('contractor_documents')
        .update({ is_verified })
        .eq('id', id)
        .select('id');
      return assertWrote(data, error);
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (doc: Pick<ContractorDocument, 'id' | 'file_url'>): Promise<void> => {
      const { data, error } = await supabase.from('contractor_documents').delete().eq('id', doc.id).select('id');
      assertWrote(data, error);
      const objectKey = contractorDocumentKey(doc.file_url);
      if (objectKey) {
        const { error: storageError } = await supabase.storage.from(CONTRACTOR_DOCS_BUCKET).remove([objectKey]);
        // The row is gone either way; an orphaned object is worth saying out loud, not failing over.
        if (storageError) throw new Error(`The record was removed but the file could not be deleted from storage: ${storageError.message}`);
      }
    },
    onSuccess: invalidate,
  });

  return {
    documents: list.data ?? [],
    isLoading: list.isLoading,
    isError: list.isError,
    error: list.error,
    upload,
    setVerified,
    remove,
  };
}

export function useContractorHistory(contractorId: string | null | undefined) {
  const enabled = !!contractorId;
  const key = CONTRACTOR_HISTORY_KEY(contractorId ?? '');

  const issues = useQuery({
    queryKey: [...key, 'issues'],
    queryFn: async (): Promise<ContractorIssue[]> => {
      const { data, error } = await supabase
        .from('issues')
        .select('id, title, status, priority, created_at, resolved_at, actual_cost, building_id, buildings(name)')
        .eq('contractor_id', contractorId!)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return ((data ?? []) as unknown as RawIssue[]).map(({ buildings, ...row }) => ({
        ...row,
        building_name: buildings?.name ?? null,
      }));
    },
    enabled,
    staleTime: 60_000,
  });

  const services = useQuery({
    queryKey: [...key, 'services'],
    queryFn: async (): Promise<ContractorService[]> => {
      const { data, error } = await supabase
        .from('asset_service_history')
        .select('id, service_date, service_type, description, cost, next_service_date, asset_id, building_assets(name, building_id)')
        .eq('contractor_id', contractorId!)
        .order('service_date', { ascending: false });
      if (error) throw new Error(error.message);
      return ((data ?? []) as unknown as RawService[]).map(({ building_assets, ...row }) => ({
        ...row,
        asset_name: building_assets?.name ?? null,
        building_id: building_assets?.building_id ?? null,
      }));
    },
    enabled,
    staleTime: 60_000,
  });

  const ratings = useQuery({
    queryKey: [...key, 'ratings'],
    queryFn: async (): Promise<ContractorRating[]> => {
      const { data, error } = await supabase
        // contractor_ratings is not yet in the generated types; regenerate after the migration ships.
        .from('contractor_ratings' as never)
        .select('id, contractor_id, issue_id, rating, comment, rated_by, created_at')
        .eq('contractor_id', contractorId!)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as ContractorRating[];
    },
    enabled,
    staleTime: 60_000,
  });

  return {
    issues: issues.data ?? [],
    services: services.data ?? [],
    ratings: ratings.data ?? [],
    isLoading: issues.isLoading || services.isLoading || ratings.isLoading,
    isError: issues.isError || services.isError || ratings.isError,
  };
}
