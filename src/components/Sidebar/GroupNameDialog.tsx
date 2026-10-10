import { useState } from 'react';
import { X } from 'lucide-react';
import { useModalKeys } from '../../utils/useModalKeys';
import { t, useT } from '../../i18n';

interface Props {
  title: string;
  initialName?: string;
  onClose: () => void;
  onSubmit: (name: string) => void | Promise<void>;
}

/** Small modal for creating / renaming a sidebar folder. */
export function GroupNameDialog({ title, initialName = '', onClose, onSubmit }: Props) {
  const t = useT();
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const n = name.trim();
    if (!n) return;
    setSaving(true);
    try {
      await onSubmit(n);
    } finally {
      setSaving(false);
    }
  };

  useModalKeys({ onCancel: onClose, onSubmit: () => void submit(), disabled: saving });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 380 }}>
        <div className="modal-header">
          <span>{title}</span>
          <button className="btn ghost icon-btn" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
        <div className="modal-body">
          <div className="form-row">
            <label>{t('目录名称')}</label>
            <input
              value={name}
              autoFocus
              placeholder={t('例如：生产环境')}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        </div>
        <div className="modal-footer">
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>
            {t('取消')}
          </button>
          <button className="btn primary" onClick={() => void submit()} disabled={saving || !name.trim()}>
            {t('确定')}
          </button>
        </div>
      </div>
    </div>
  );
}
