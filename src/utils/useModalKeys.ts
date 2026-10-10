import { useEffect } from 'react';

/**
 * Standard modal keyboard behavior: Esc cancels, Enter submits.
 * Enter is ignored inside multi-line fields and when a button has focus
 * (so the focused button keeps its own activation), and both keys are
 * ignored while `disabled` (e.g. a deploy/save is in flight).
 */
export function useModalKeys(opts: {
  onCancel: () => void;
  onSubmit?: () => void;
  disabled?: boolean;
}) {
  const { onCancel, onSubmit, disabled } = opts;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (disabled) return;
      const t = e.target as HTMLElement | null;
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      } else if (e.key === 'Enter' && onSubmit) {
        if (t && (t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        if (t && t.tagName === 'BUTTON') return;
        e.preventDefault();
        onSubmit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, onSubmit, disabled]);
}
