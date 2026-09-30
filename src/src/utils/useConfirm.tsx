import { ReactNode, useCallback, useState } from 'react';
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

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setPending({ ...opts, resolve });
    });
  }, []);

  const dialog = pending ? (
    <ConfirmDialog
      title={pending.title}
      message={pending.message}
      confirmLabel={pending.confirmLabel}
      danger={pending.danger}
      onConfirm={() => {
        pending.resolve(true);
        setPending(null);
      }}
      onCancel={() => {
        pending.resolve(false);
        setPending(null);
      }}
    />
  ) : null;

  return [dialog, confirm];
}
