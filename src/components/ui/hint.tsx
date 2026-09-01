/**
 * Guidance copy that renders only while the user has hints switched on (useHints).
 * For coaching and tips ONLY — never route validation errors, warnings, or
 * unsaved-changes cues through this: those must stay visible with hints off.
 */
import type { ReactNode } from 'react';
import { Lightbulb } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useHints } from '@/hooks/useHints';

interface HintProps {
  children: ReactNode;
  className?: string;
  /** Set false for inline helper text where the lightbulb would be noise. */
  icon?: boolean;
}

export function Hint({ children, className, icon = true }: HintProps) {
  const { hintsEnabled } = useHints();
  if (!hintsEnabled) return null;
  return (
    <p className={cn('flex items-start gap-1.5 text-xs text-muted-foreground', className)}>
      {icon && <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
      <span>{children}</span>
    </p>
  );
}
