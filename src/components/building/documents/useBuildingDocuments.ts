import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { BuildingDocumentRow } from './types';

export interface DocumentFormValues {
  name: string;
  document_type: string;
  reference_number: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  issuing_authority: string | null;
  notes: string | null;
}

const KEY = (buildingId: string) => ['building-documents', buildingId];

async function uploadOne(buildingId: string, file: File): Promise<string> {
  const ext = file.name.split('.').pop();
  // Path prefix `documents/<buildingId>/` is required by the storage policy.
  const path = `documents/${buildingId}/${Date.now()}-${Math.random().toString(36).slice(2, 9)}.${ext}`;
  const { error } = await supabase.storage.from('tenant-documents').upload(path, file);
  if (error) throw error;
  // Keep storing the public-URL form (iOS + existing rows read this column).
  return supabase.storage.from('tenant-documents').getPublicUrl(path).data.publicUrl;
}

/** Object key inside the bucket, recovered from the stored public-URL form. */
function objectKey(fileUrl: string | null | undefined): string | null {
  if (!fileUrl) return null;
  const parts = fileUrl.split('/tenant-documents/');
  return parts.length > 1 ? decodeURIComponent(parts[1]) : null;
}

/** Delete the underlying objects; a failure leaves an orphan, so say so out loud. */
async function removeObjects(keys: string[]) {
  if (keys.length === 0) return;
  const { error } = await supabase.storage.from('tenant-documents').remove(keys);
  if (error) {
    toast.error(`The file could not be removed from storage: ${error.message}`);
  }
}

export function useBuildingDocuments(buildingId: string) {
  const qc = useQueryClient();

  const list = useQuery({
    queryKey: KEY(buildingId),
    queryFn: async (): Promise<BuildingDocumentRow[]> => {
      const { data, error } = await supabase
        .from('building_documents')
        .select('*')
        .eq('building_id', buildingId)
        .order('name');
      if (error) throw error;
      return (data ?? []) as BuildingDocumentRow[];
    },
    enabled: !!buildingId,
    staleTime: 60_000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: KEY(buildingId) });

  /** Create one row per uploaded file (multi-upload), each with the same metadata. */
  const create = useMutation({
    mutationFn: async (args: { values: DocumentFormValues; files: File[]; userId: string | null }) => {
      const { values, files, userId } = args;
      if (files.length === 0) {
        const { error } = await supabase
          .from('building_documents')
          .insert({ ...values, building_id: buildingId, file_url: null, uploaded_by: userId });
        if (error) throw error;
        return;
      }
      const rows = await Promise.all(
        files.map(async (file, i) => ({
          ...values,
          // When multiple files share one metadata set, suffix the name to keep them distinct.
          name: files.length > 1 ? `${values.name} (${i + 1})` : values.name,
          building_id: buildingId,
          file_url: await uploadOne(buildingId, file),
          uploaded_by: userId,
        })),
      );
      const { error } = await supabase.from('building_documents').insert(rows);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: async (args: {
      id: string;
      values: DocumentFormValues;
      file: File | null;
      userId: string | null;
    }) => {
      const { id, values, file, userId } = args;
      let previousKey: string | null = null;
      if (file) {
        const { data: existing } = await supabase
          .from('building_documents')
          .select('file_url')
          .eq('id', id)
          .maybeSingle();
        previousKey = objectKey(existing?.file_url);
      }
      const file_url = file ? await uploadOne(buildingId, file) : undefined;
      const patch = { ...values, ...(file_url ? { file_url } : {}), uploaded_by: userId };
      const { error } = await supabase.from('building_documents').update(patch).eq('id', id);
      if (error) throw error;
      // Only once the row points at the replacement, so a failed write keeps the old file.
      if (previousKey) await removeObjects([previousKey]);
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (ids: string[]) => {
      const { data: rows, error: readError } = await supabase
        .from('building_documents')
        .select('id, file_url')
        .in('id', ids);
      if (readError) throw readError;
      const keys = (rows ?? [])
        .map((row) => objectKey(row.file_url))
        .filter((key): key is string => !!key);
      // Delete the row first and confirm it actually went: an RLS-denied delete
      // returns 204 with zero rows and no error, so without the affected-row
      // check a refused delete would still destroy the file it points at.
      const { data: deleted, error } = await supabase
        .from('building_documents')
        .delete()
        .in('id', ids)
        .select('id');
      if (error) throw error;
      if ((deleted ?? []).length < ids.length) {
        throw new Error('Some documents could not be removed — your role does not permit it.');
      }
      await removeObjects(keys);
    },
    onSuccess: invalidate,
  });

  return { list, create, update, remove };
}
