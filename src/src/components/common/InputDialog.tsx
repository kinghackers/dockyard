import { useState } from 'react';
import { X } from 'lucide-react';
import { useModalKeys } from '../../utils/useModalKeys';

interface Props {
  title: string;
  label: string;
  initial?: string;
  placeholder?: string;
  confirmLabel?: string;
  onSubmit: (value: string) => void | Promise<void>;
  onClose: () => void;
}

/** Small single-field modal prompt (rename / commit repo / etc). */
export function InputDialog({
  title,
  label,
  initial = '',
  placeholder,
  confirmLabel = '确定',
  onSubmit,
  onClose,
}: Props) {
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!value.trim() || saving) return;
    setSaving(true);
    try {
      await onSubmit(value.trim());
    } finally {
      setSaving(false);
    }
  };

  useModalKeys({ onCancel: onClose, onSubmit: () => void submit(), disabled: saving });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 420 }}>
        <div className="modal-header">
          <span>{title}</span>
          <button className="btn ghost icon-btn" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
        <div className="modal-body">
          <div className="form-row">
            <label>{label}</label>
            <input
              value={value}
              autoFocus
              placeholder={placeholder}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
        </div>
        <div className="modal-footer">
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose} disabled={saving}>
            取消
          </button>
          <button className="btn primary" onClick={() => void submit()} disabled={saving || !value.trim()}>
            {saving ? '处理中…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
