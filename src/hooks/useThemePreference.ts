import { useEffect } from 'react';
import { useTheme } from 'next-themes';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';

export function useThemePreference() {
  const { theme, setTheme } = useTheme();
  const { user, loading } = useAuth();

  // Load theme preference from database when user logs in
  useEffect(() => {
    if (loading || !user) return;

    const loadThemePreference = async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('theme_preference')
        .eq('id', user.id)
        .single();

      if (!error && data?.theme_preference) {
        setTheme(data.theme_preference);
      }
    };

    loadThemePreference();
  }, [user, loading, setTheme]);

  // Save theme preference to database
  const saveThemePreference = async (newTheme: string) => {
    setTheme(newTheme);
    
    if (!user) return;

    await supabase
      .from('profiles')
      .update({ theme_preference: newTheme })
      .eq('id', user.id);
  };

  return { theme, setTheme: saveThemePreference };
}
