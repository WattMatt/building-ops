/**
 * Custom hook for fetching and managing buildings data
 * Centralizes building-related data fetching logic
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { Tables } from '@/integrations/supabase/types';

type Building = Tables<'buildings'>;

interface BuildingWithDetails extends Building {
  // Add any joined data here
}

interface UseBuildingsOptions {
  autoFetch?: boolean;
}

interface UseBuildingsReturn {
  buildings: BuildingWithDetails[];
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
  deleteBuilding: (id: string) => Promise<boolean>;
}

export function useBuildings(
  options: UseBuildingsOptions = { autoFetch: true }
): UseBuildingsReturn {
  const [buildings, setBuildings] = useState<BuildingWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchBuildings = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: fetchError } = await supabase
        .from('buildings')
        .select('*')
        .order('name');

      if (fetchError) throw fetchError;
      setBuildings(data || []);
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to fetch buildings');
      setError(error);
      console.error('Error fetching buildings:', err);
      toast.error('Failed to load buildings');
    } finally {
      setLoading(false);
    }
  }, []);

  const deleteBuilding = useCallback(async (id: string): Promise<boolean> => {
    try {
      const { error: deleteError } = await supabase
        .from('buildings')
        .delete()
        .eq('id', id);

      if (deleteError) throw deleteError;

      setBuildings((prev) => prev.filter((b) => b.id !== id));
      toast.success('Building deleted successfully');
      return true;
    } catch (err) {
      console.error('Error deleting building:', err);
      toast.error('Failed to delete building');
      return false;
    }
  }, []);

  useEffect(() => {
    if (options.autoFetch) {
      fetchBuildings();
    }
  }, [options.autoFetch, fetchBuildings]);

  return {
    buildings,
    loading,
    error,
    refetch: fetchBuildings,
    deleteBuilding,
  };
}

// Hook for fetching a single building
export function useBuilding(id: string | undefined) {
  const [building, setBuilding] = useState<Building | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchBuilding = useCallback(async () => {
    if (!id) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data, error: fetchError } = await supabase
        .from('buildings')
        .select('*')
        .eq('id', id)
        .single();

      if (fetchError) throw fetchError;
      setBuilding(data);
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to fetch building');
      setError(error);
      console.error('Error fetching building:', err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchBuilding();
  }, [fetchBuilding]);

  return {
    building,
    loading,
    error,
    refetch: fetchBuilding,
  };
}
