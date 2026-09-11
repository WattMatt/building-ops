/** Consistent shell for every report section: heading, hint, optional Save footer.
 *  The hint renders through <Hint>, so the header lightbulb toggle hides every
 *  section's guidance copy at once for experienced users. */
import type { ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { Hint } from '@/components/ui/hint';
import { useReportDirty } from './dirtySections';

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
  // Every section reports through here, so grids and narrative sections alike guard unsaved edits (D1).
  useReportDirty(title, !!dirty);
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle>{title}</CardTitle>
          {hint && <Hint className="mt-1.5">{hint}</Hint>}
        </div>
        {headerAccessory}
      </CardHeader>
      <CardContent className="space-y-4">
        {children}
        {onSave && !readOnly && (
          <div className="flex items-center justify-end gap-3 border-t pt-4">
            {/* State cue, not a hint: stays visible with hints switched off. */}
            {dirty && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
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
