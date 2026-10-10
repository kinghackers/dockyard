import { useEffect, useRef } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { t, useT } from '../../i18n';

interface Props {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  /** false while the owning keep-alive page is hidden — key handling pauses */
  active?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

/**
 * IDEA-style modal confirmation. Replaces window.confirm which is
 * non-native in Electron and blocks the whole app.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = t('确定'),
  danger = false,
  active = true,
  onConfirm,
  onCancel,
}: Props) {
  const t = useT();
  const initialFocusRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // destructive confirms focus Cancel so a stray Enter cannot fire them
    if (active) initialFocusRef.current?.focus();
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      // never confirm off a keystroke aimed at a text field (a hidden
      // keep-alive page's input can be the typing surface)
      const typing =
        el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      } else if (e.key === 'Enter' && !danger && !typing) {
        e.preventDefault();
        void onConfirm();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, onConfirm, danger, active]);

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 400 }}
        role="dialog"
        aria-modal="true"
      >
        <div className="modal-header">
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={16} color={danger ? 'var(--error)' : 'var(--warning)'} />
            {title}
          </span>
          <button className="btn ghost icon-btn" onClick={onCancel} tabIndex={-1}>
            <X size={15} />
          </button>
        </div>
        <div className="modal-body" style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text)' }}>
          {message}
        </div>
        <div className="modal-footer">
          <button
            ref={danger ? initialFocusRef : undefined}
            className="btn"
            onClick={onCancel}
          >
            {t('取消')}
          </button>
          <button
            ref={danger ? undefined : initialFocusRef}
            className={`btn ${danger ? 'danger' : 'primary'}`}
            onClick={() => void onConfirm()}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
