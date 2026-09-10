/**
 * Dialog on desktop, bottom sheet (vaul Drawer) on phones. Same API surface as the shadcn
 * Dialog parts so a call site swaps imports and nothing else. The Drawer gets a max height and
 * its own scroll area so long forms stay reachable above the keyboard.
 *
 * The phone/desktop decision is made ONCE, when the dialog opens, from `window.innerWidth`, and
 * handed to every `ResponsiveDialog*` part through context. Deciding synchronously means a phone
 * never mounts the desktop Dialog for a first frame, and deciding once means a resize (or a
 * keyboard-driven viewport change) while the dialog is open never swaps the subtree between
 * Dialog and Drawer, which would drop child state such as a half-written comment. The next open
 * re-evaluates the viewport.
 *
 * A part rendered outside a `ResponsiveDialog` falls back to tracking the viewport itself (same
 * breakpoint as `useIsMobile`) so the API stays tolerant.
 */
import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from 'react';
import { Drawer as DrawerPrimitive } from 'vaul';
import { X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Mirrors the breakpoint in `@/hooks/use-mobile`; below it the sheet is used. */
const MOBILE_BREAKPOINT = 768;

const isPhoneViewport = () => typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT;

type Mode = { mobile: boolean };

const ResponsiveDialogModeContext = createContext<Mode | null>(null);

/**
 * The mode decided by the enclosing `ResponsiveDialog`. A part rendered outside one falls back
 * to tracking the viewport itself, the way `useIsMobile` does; the subscription is only created
 * in that case so parts inside a dialog neither re-render on viewport changes nor hold listeners.
 */
function useResponsiveDialogMode(): boolean {
  const ctx = useContext(ResponsiveDialogModeContext);
  const [fallback, setFallback] = useState(isPhoneViewport);
  useEffect(() => {
    if (ctx) return;
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => setFallback(isPhoneViewport());
    mql.addEventListener('change', onChange);
    onChange();
    return () => mql.removeEventListener('change', onChange);
  }, [ctx]);
  return ctx ? ctx.mobile : fallback;
}

type RootProps = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
  /**
   * Set when this dialog is rendered from inside another open `ResponsiveDialog` (e.g. the
   * resolve sheet inside the issue detail sheet). On phones the inner sheet is mounted as a
   * nested vaul Root: it neither restores the page's body styles nor un-scales the page
   * background when it closes, both of which still belong to the parent sheet.
   *
   * vaul 0.9.9's `Drawer.NestedRoot` is deliberately not used: it destructures `onOpenChange`
   * away and never forwards it (see node_modules/vaul/dist/index.mjs, `function NestedRoot`),
   * so a controlled nested sheet could not be dismissed by drag, overlay tap or Escape, and its
   * parent-scaling hook only fires for uncontrolled opens anyway.
   */
  nested?: boolean;
};

export function ResponsiveDialog({ nested = false, ...props }: RootProps) {
  const [mobile, setMobile] = useState(isPhoneViewport);
  // Re-decide only on the closed -> open transition (React's "adjust state on prop change"
  // pattern). While closed the Dialog/Drawer render no content, so nothing is lost by switching.
  const [prevOpen, setPrevOpen] = useState(props.open);
  if (props.open !== prevOpen) {
    setPrevOpen(props.open);
    if (props.open) setMobile(isPhoneViewport());
  }
  const mode = useMemo<Mode>(() => ({ mobile }), [mobile]);

  let root: ReactNode;
  if (!mobile) {
    root = <Dialog {...props} />;
  } else if (nested) {
    root = <DrawerPrimitive.Root nested shouldScaleBackground={false} {...props} />;
  } else {
    root = <Drawer {...props} />;
  }
  return <ResponsiveDialogModeContext.Provider value={mode}>{root}</ResponsiveDialogModeContext.Provider>;
}

export const ResponsiveDialogContent = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<typeof DialogContent>>(
  function ResponsiveDialogContent({ className, children, ...rest }, ref) {
    const mobile = useResponsiveDialogMode();
    if (mobile) {
      // Call-site classes go first so the sheet's own height and overflow win over desktop
      // values such as `max-h-[90vh] overflow-y-auto`; the inner div is the single scroll
      // region (min-h-0 lets it shrink inside the flex column so it actually scrolls).
      return (
        <DrawerContent ref={ref} className={cn(className, 'max-h-[92dvh] overflow-hidden')} {...rest}>
          <DrawerClose asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Close"
              className="absolute right-2 top-2 h-11 w-11 text-muted-foreground"
            >
              <X className="h-5 w-5" />
            </Button>
          </DrawerClose>
          <div className="min-h-0 overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{children}</div>
        </DrawerContent>
      );
    }
    return (
      <DialogContent ref={ref} className={className} {...rest}>
        {children}
      </DialogContent>
    );
  },
);

export function ResponsiveDialogHeader({ className, ...props }: ComponentProps<'div'>) {
  const mobile = useResponsiveDialogMode();
  return mobile ? (
    // pr-12 keeps the title clear of the 44px close button in the sheet's top-right corner.
    <DrawerHeader className={cn('px-0 pr-12 text-left', className)} {...props} />
  ) : (
    <DialogHeader className={className} {...props} />
  );
}

/**
 * Keep JSX order Cancel -> primary. Desktop shows that order left-to-right; the sheet stacks the
 * buttons full width, 44px tall, reversed so the primary action sits on top nearest the thumb.
 */
export function ResponsiveDialogFooter({ className, ...props }: ComponentProps<'div'>) {
  const mobile = useResponsiveDialogMode();
  return mobile ? (
    <DrawerFooter className={cn('flex-col-reverse px-0 [&>button]:h-11', className)} {...props} />
  ) : (
    // gap instead of the shadcn space-x so a call-site `gap-*` sets the spacing outright.
    <DialogFooter className={cn('gap-2 sm:space-x-0', className)} {...props} />
  );
}

export function ResponsiveDialogTitle(props: ComponentProps<typeof DialogTitle>) {
  const mobile = useResponsiveDialogMode();
  return mobile ? <DrawerTitle {...props} /> : <DialogTitle {...props} />;
}

export function ResponsiveDialogDescription(props: ComponentProps<typeof DialogDescription>) {
  const mobile = useResponsiveDialogMode();
  return mobile ? <DrawerDescription {...props} /> : <DialogDescription {...props} />;
}
