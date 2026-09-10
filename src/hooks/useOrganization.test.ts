import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const state = vi.hoisted(() => ({ session: null as null | { user: { id: string } }, tables: [] as string[] }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: state.session } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    from: (table: string) => {
      state.tables.push(table);
      const row = table === 'organizations'
        ? { id: 'o1', name: 'Org', email: 'x@y.z', logo_url: null, primary_color: '#111111', created_at: null, updated_at: null }
        : { id: 'o1', name: 'Org', logo_url: null, primary_color: '#111111' };
      const chain = { select: () => chain, limit: () => chain, maybeSingle: async () => ({ data: row, error: null }) };
      return chain;
    },
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel: () => {},
  },
}));

import { useOrganization } from './useOrganization';

beforeEach(() => { state.tables = []; state.session = null; });

describe('useOrganization', () => {
  it('reads organization_branding when signed out', async () => {
    const { result } = renderHook(() => useOrganization());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(state.tables).toEqual(['organization_branding']);
    expect(result.current.organization?.primary_color).toBe('#111111');
    expect(result.current.organization?.email).toBeNull();
  });
  it('reads organizations when signed in', async () => {
    state.session = { user: { id: 'u1' } };
    const { result } = renderHook(() => useOrganization());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(state.tables).toEqual(['organizations']);
    expect(result.current.organization?.email).toBe('x@y.z');
  });
});
