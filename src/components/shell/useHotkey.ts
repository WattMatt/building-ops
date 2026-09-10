import { useEffect, useRef } from 'react';

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/**
 * Global keyboard shortcut. `meta` accepts either ⌘ (macOS) or Ctrl (everything else).
 * A plain-letter hotkey is ignored while the user is typing in a field, so it never eats
 * input; a `meta` chord is not, because ⌘K / Ctrl+K types nothing and users expect it to
 * work from inside a search box or a comment.
 * The handler lives in a ref so the window listener is registered once per key/modifier.
 */
export function useHotkey(key: string, opts: { meta?: boolean }, handler: () => void) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const meta = !!opts.meta;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== key) return;
      if (meta && !(e.metaKey || e.ctrlKey)) return;
      if (!meta && isEditable(e.target)) return;
      e.preventDefault();
      handlerRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [key, meta]);
}
