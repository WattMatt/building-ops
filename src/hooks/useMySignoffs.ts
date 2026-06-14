import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface MySignoff {
  id: string;
  submission_id: string;
  due_at: string | null;
  sequence_order: number;
  form_name: string;
  building_name: string | null;
}

export function useMySignoffs() {
  const { user } = useAuth();
  const [items, setItems] = useState<MySignoff[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data: reqs } = await supabase
        .from('form_signoff_requests')
        .select('id, submission_id, due_at, sequence_order')
        .eq('assigned_to', user.id)
        .eq('active', true)
        .eq('status', 'pending')
        .order('due_at', { nullsFirst: false });

      const subIds = [...new Set((reqs || []).map((r) => r.submission_id))];
      const subs = subIds.length
        ? (await supabase.from('form_submissions').select('id, form_name, building_id').in('id', subIds)).data || []
        : [];
      const subMap = new Map(subs.map((s) => [s.id, s]));

      const bIds = [...new Set(subs.map((s) => s.building_id).filter(Boolean))] as string[];
      const blds = bIds.length
        ? (await supabase.from('buildings').select('id, name').in('id', bIds)).data || []
        : [];
      const bMap = new Map(blds.map((b) => [b.id, b.name]));

      setItems(
        (reqs || []).map((r) => {
          const s = subMap.get(r.submission_id);
          return {
            id: r.id,
            submission_id: r.submission_id,
            due_at: r.due_at,
            sequence_order: r.sequence_order,
            form_name: s?.form_name ?? 'Form',
            building_name: s?.building_id ? bMap.get(s.building_id) ?? null : null,
          };
        }),
      );
    } catch (e) {
      console.error('useMySignoffs error:', e);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  return { items, loading, reload: load };
}
