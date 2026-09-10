/**
 * Dialog on desktop, bottom sheet (vaul Drawer) on phones. Same API surface as the shadcn
 * Dialog parts so a call site swaps imports and nothing else. The Drawer gets a max height and
 * its own scroll area so long forms stay reachable above the keyboard.
 *
 * `useIsMobile` reports false on the very first render and corrects itself in an effect, so a
 * phone briefly mounts the desktop Dialog for one frame. That is accepted here on purpose.
 */
import type { ComponentProps, ReactNode } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
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
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { cn } from '@/lib/utils';

type RootProps = { open?: boolean; onOpenChange?: (open: boolean) => void; children: ReactNode };

export function ResponsiveDialog(props: RootProps) {
  const mobile = useIsMobile();
  return mobile ? <Drawer {...props} /> : <Dialog {...props} />;
}

export function ResponsiveDialogContent({ className, children, ...rest }: ComponentProps<typeof DialogContent>) {
  const mobile = useIsMobile();
  if (mobile) {
    // Width utilities (max-w-*) from call sites are harmless on a full-width sheet; the desktop
    // max-height/overflow the call sites set are replaced by the sheet's own scroll area below.
    return (
      <DrawerContent className={cn('max-h-[92dvh]', className)}>
        <div className="overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{children}</div>
      </DrawerContent>
    );
  }
  return (
    <DialogContent className={className} {...rest}>
      {children}
    </DialogContent>
  );
}

export function ResponsiveDialogHeader({ className, ...props }: ComponentProps<'div'>) {
  const mobile = useIsMobile();
  return mobile ? (
    <DrawerHeader className={cn('px-0 text-left', className)} {...props} />
  ) : (
    <DialogHeader className={className} {...props} />
  );
}

export function ResponsiveDialogFooter({ className, ...props }: ComponentProps<'div'>) {
  const mobile = useIsMobile();
  return mobile ? (
    <DrawerFooter className={cn('px-0 [&>button]:h-11', className)} {...props} />
  ) : (
    <DialogFooter className={className} {...props} />
  );
}

export function ResponsiveDialogTitle(props: ComponentProps<typeof DialogTitle>) {
  const mobile = useIsMobile();
  return mobile ? <DrawerTitle {...props} /> : <DialogTitle {...props} />;
}

export function ResponsiveDialogDescription(props: ComponentProps<typeof DialogDescription>) {
  const mobile = useIsMobile();
  return mobile ? <DrawerDescription {...props} /> : <DialogDescription {...props} />;
}
