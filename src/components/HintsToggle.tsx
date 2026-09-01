/**
 * Header toggle for in-app hints & tips: off once users know the ropes, back on
 * for a refresher. Sits next to ThemeToggle so it is findable from every page —
 * including while hints are hidden.
 */
import { Lightbulb, LightbulbOff } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useHints } from '@/hooks/useHints';

export function HintsToggle() {
  const { hintsEnabled, setHintsEnabled } = useHints();
  const label = hintsEnabled ? 'Hide hints & tips' : 'Show hints & tips';

  const toggle = () => {
    const next = !hintsEnabled;
    setHintsEnabled(next);
    toast.info(next
      ? 'Hints & tips are back on.'
      : 'Hints & tips are off. The lightbulb up top brings them back whenever you want a refresher.');
  };

  return (
    <Button variant="ghost" size="icon" className="h-9 w-9" onClick={toggle} title={label} aria-pressed={hintsEnabled}>
      {hintsEnabled ? <Lightbulb className="h-4 w-4" /> : <LightbulbOff className="h-4 w-4" />}
      <span className="sr-only">{label}</span>
    </Button>
  );
}
