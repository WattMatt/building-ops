/** Consistent shell for every report section: heading, hint, optional Save footer. */
import type { ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

interface SectionCardProps {
  title: string;
  hint?: string;
  /** right-aligned header content, e.g. a live score badge */
  headerAccessory?: ReactNode;
  children: ReactNode;
  /** when provided, renders a footer Save button */
  onSave?: () => void;
  saving?: boolean;
  dirty?: boolean;
  readOnly?: boolean;
}

export function SectionCard({ title, hint, headerAccessory, children, onSave, saving, dirty, readOnly }: SectionCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle>{title}</CardTitle>
          {hint && <CardDescription className="mt-1">{hint}</CardDescription>}
        </div>
        {headerAccessory}
      </CardHeader>
      <CardContent className="space-y-4">
        {children}
        {onSave && !readOnly && (
          <div className="flex justify-end border-t pt-4">
            <Button onClick={onSave} disabled={saving || !dirty}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {dirty ? 'Save section' : 'Saved'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
