import { useState } from 'react';
import { X } from 'lucide-react';
import type { CreateVolumeOptions } from '../../types/docker';
import { useModalKeys } from '../../utils/useModalKeys';
import { t, useT } from '../../i18n';

interface Props {
  hostId: string;
  onClose: () => void;
  onCreated: (volumeName: string) => void | Promise<void>;
}

export function CreateVolumeDialog({ hostId, onClose, onCreated }: Props) {
  const t = useT();
  const [name, setName] = useState('');
  const [driver, setDriver] = useState('local');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!name.trim()) {
      setError(t('请输入数据卷名称'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const opts: CreateVolumeOptions = {
        name: name.trim(),
        driver: driver.trim() || 'local',
      };
      const created = await window.dockerApi.createVolume(hostId, opts);
      await onCreated(created);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  useModalKeys({ onCancel: onClose, onSubmit: () => void handleCreate(), disabled: saving });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 420 }}>
        <div className="modal-header">
          <span>{t('创建数据卷')}</span>
          <button className="btn ghost icon-btn" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        <div className="modal-body">
          <div className="form-row">
            <label>{t('名称 *')}</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('如 my-volume')} autoFocus />
          </div>
          <div className="form-row">
            <label>{t('驱动')}</label>
            <select value={driver} onChange={(e) => setDriver(e.target.value)}>
              <option value="local">{t('本地（local）')}</option>
              <option value="nfs">NFS</option>
            </select>
          </div>

          {error && (
            <div
              style={{
                background: 'var(--error-soft)',
                border: '1px solid var(--error)',
                color: 'var(--error)',
                padding: '8px 10px',
                borderRadius: 4,
                fontSize: 12,
              }}
            >
              {error}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onClose} disabled={saving}>
            {t('取消')}
          </button>
          <button className="btn primary" onClick={handleCreate} disabled={saving || !name.trim()}>
            {saving ? t('创建中…') : t('创建')}
          </button>
        </div>
      </div>
    </div>
  );
}
