import { useState } from 'react';
import { X } from 'lucide-react';
import type { CreateVolumeOptions } from '../../types/docker';
import { useModalKeys } from '../../utils/useModalKeys';

interface Props {
  hostId: string;
  onClose: () => void;
  onCreated: (volumeName: string) => void | Promise<void>;
}

export function CreateVolumeDialog({ hostId, onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [driver, setDriver] = useState('local');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!name.trim()) {
      setError('请输入数据卷名称');
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
          <span>创建数据卷</span>
          <button className="btn ghost icon-btn" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        <div className="modal-body">
          <div className="form-row">
            <label>名称 *</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="如 my-volume" autoFocus />
          </div>
          <div className="form-row">
            <label>驱动</label>
            <select value={driver} onChange={(e) => setDriver(e.target.value)}>
              <option value="local">本地（local）</option>
              <option value="nfs">NFS</option>
            </select>
          </div>

          {error && (
            <div
              style={{
                background: 'rgba(207,91,86,0.15)',
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
            取消
          </button>
          <button className="btn primary" onClick={handleCreate} disabled={saving || !name.trim()}>
            {saving ? '创建中…' : '创建'}
          </button>
        </div>
      </div>
    </div>
  );
}
