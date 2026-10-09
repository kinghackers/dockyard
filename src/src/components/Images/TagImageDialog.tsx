import { useState } from 'react';
import { X } from 'lucide-react';
import { useModalKeys } from '../../utils/useModalKeys';
import { t, useT } from '../../i18n';

interface Props {
  initialRepo?: string;
  initialTag?: string;
  onClose: () => void;
  onSubmit: (repo: string, tag: string) => void | Promise<void>;
}

/** Small modal to add a repo:tag to an existing image. */
export function TagImageDialog({ initialRepo = '', initialTag = 'latest', onClose, onSubmit }: Props) {
  const t = useT();
  const [repo, setRepo] = useState(initialRepo);
  const [tag, setTag] = useState(initialTag);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const r = repo.trim();
    const t = tag.trim() || 'latest';
    if (!r) return;
    setSaving(true);
    try {
      await onSubmit(r, t);
    } finally {
      setSaving(false);
    }
  };

  useModalKeys({ onCancel: onClose, onSubmit: () => void submit(), disabled: saving });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 420 }}>
        <div className="modal-header">
          <span>{t('打标签')}</span>
          <button className="btn ghost icon-btn" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
        <div className="modal-body">
          <div className="form-grid">
            <div className="form-row" style={{ gridColumn: '1 / -1' }}>
              <label>{t('仓库 / 镜像名 *')}</label>
              <input
                value={repo}
                autoFocus
                placeholder={t('myapp 或 registry.example.com/myapp')}
                onChange={(e) => setRepo(e.target.value)}
              />
            </div>
            <div className="form-row">
              <label>{t('标签')}</label>
              <input
                value={tag}
                placeholder="latest"
                onChange={(e) => setTag(e.target.value)}
              />
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
            将为该镜像追加 <span className="mono">{`${repo.trim() || 'name'}:${tag.trim() || 'latest'}`}</span>
          </div>
        </div>
        <div className="modal-footer">
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>
            {t('取消')}
          </button>
          <button className="btn primary" onClick={() => void submit()} disabled={saving || !repo.trim()}>
            {t('确定')}
          </button>
        </div>
      </div>
    </div>
  );
}
