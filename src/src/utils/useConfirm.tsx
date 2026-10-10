import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { ConfirmDialog } from '../components/common/ConfirmDialog';

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}

/**
 * Imperative confirm: `const [dialog, confirm] = useConfirm();`
 * then `if (await confirm({ title, message, danger })) ...`
 * Render `{dialog}` next to the page content.
 */
export function useConfirm(): [ReactNode, (opts: ConfirmOptions) => Promise<boolean>] {
  const [pending, setPending] = useState<
    (ConfirmOptions & { resolve: (ok: boolean) => void }) | null
  >(null);
  const resolveRef = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      // a stacked confirm replaces the pending one — cancel it instead of
      // leaving its promise unresolved forever
      resolveRef.current?.(false);
      resolveRef.current = resolve;
      setPending({ ...opts, resolve });
    });
  }, []);

  // keep-alive pages can unmount with a dialog open (host tab closed while a
  // caller awaits confirm) — settle the promise so callers don't hang forever
  useEffect(
    () => () => {
      resolveRef.current?.(false);
      resolveRef.current = null;
    },
    []
  );

  const settle = (ok: boolean) => {
    if (!pending) return;
    pending.resolve(ok);
    resolveRef.current = null;
    setPending(null);
  };

  const dialog = pending ? (
    <ConfirmDialog
      title={pending.title}
      message={pending.message}
      confirmLabel={pending.confirmLabel}
      danger={pending.danger}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  ) : null;

  return [dialog, confirm];
}
