import { ReactNode } from 'react';
import { useOrganizationTheme } from '@/hooks/useOrganizationTheme';

interface OrganizationThemeProviderProps {
  children: ReactNode;
}

export function OrganizationThemeProvider({ children }: OrganizationThemeProviderProps) {
  // This hook applies the theme CSS variables
  useOrganizationTheme();
  
  return <>{children}</>;
}
