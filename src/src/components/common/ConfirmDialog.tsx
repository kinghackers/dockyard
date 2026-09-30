import { useEffect, useRef } from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface Props {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
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
  confirmLabel = '确定',
  danger = false,
  onConfirm,
  onCancel,
}: Props) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        void onConfirm();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, onConfirm]);

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
          <button className="btn" onClick={onCancel}>
            取消
          </button>
          <button
            ref={confirmRef}
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
