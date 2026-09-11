import { useEffect } from 'react';
import { Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Hint } from '@/components/ui/hint';
import { useInstallPrompt } from '@/hooks/useInstallPrompt';
import { useIsMobile } from '@/hooks/use-mobile';
import { track } from '@/lib/analytics';

/**
 * "Add to home screen" offer on My Day. Shown only on a phone-sized viewport, only when the
 * browser can install (Chrome/Edge/Android) or is iOS Safari (no event; Share-sheet text).
 * The body is coaching copy, so it goes through <Hint>; the buttons stay visible regardless.
 */
export function InstallCard() {
  const { mode, install, dismiss } = useInstallPrompt();
  const isMobile = useIsMobile();
  const visible = isMobile && (mode === 'prompt' || mode === 'ios');

  useEffect(() => {
    if (visible) track('install_prompt_shown', { mode });
    // Once per visible mode: re-firing on every render would inflate the count.
  }, [visible, mode]);

  if (!visible) return null;

  const onAdd = async () => {
    const outcome = await install();
    track('install_prompt_result', { outcome });
  };

  return (
    <Card data-testid="install-card">
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Smartphone className="h-4 w-4 shrink-0" aria-hidden="true" />
          Add to home screen
        </div>
        {mode === 'prompt' ? (
          <>
            <Hint icon={false} className="text-sm">
              Add Building Ops to your home screen to open it like an app and keep your day
              available offline.
            </Hint>
            <div className="flex gap-2">
              <Button className="h-11 flex-1" onClick={() => void onAdd()}>
                Add
              </Button>
              <Button variant="outline" className="h-11 flex-1" onClick={dismiss}>
                Not now
              </Button>
            </div>
          </>
        ) : (
          <>
            <Hint icon={false} className="text-sm">
              In Safari, tap Share, then Add to Home Screen.
            </Hint>
            <Button variant="outline" className="h-11 w-full" onClick={dismiss}>
              Got it
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
