import { useState } from 'react';
import { X } from 'lucide-react';
import type { CreateNetworkOptions } from '../../types/docker';

interface Props {
  hostId: string;
  onClose: () => void;
  onCreated: (networkId: string) => void | Promise<void>;
}

export function CreateNetworkDialog({ hostId, onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [driver, setDriver] = useState('bridge');
  const [internal, setInternal] = useState(false);
  const [attachable, setAttachable] = useState(false);
  const [subnet, setSubnet] = useState('');
  const [gateway, setGateway] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!name.trim()) {
      setError('请输入网络名称');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const opts: CreateNetworkOptions = {
        name: name.trim(),
        driver: driver.trim() || 'bridge',
        internal,
        attachable,
        subnet: subnet.trim() || undefined,
        gateway: gateway.trim() || undefined,
      };
      const id = await window.dockerApi.createNetwork(hostId, opts);
      await onCreated(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 480 }}>
        <div className="modal-header">
          <span>创建网络</span>
          <button className="btn ghost icon-btn" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        <div className="modal-body">
          <div className="form-grid">
            <div className="form-row">
              <label>名称 *</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="如 my-network" autoFocus />
            </div>
            <div className="form-row">
              <label>驱动</label>
              <select value={driver} onChange={(e) => setDriver(e.target.value)}>
                <option value="bridge">桥接（bridge）</option>
                <option value="host">主机（host）</option>
                <option value="overlay">覆盖（overlay）</option>
                <option value="macvlan">macvlan</option>
                <option value="none">无（none）</option>
              </select>
            </div>
          </div>

          <div className="form-grid">
            <div className="form-row">
              <label>子网 (可选)</label>
              <input value={subnet} onChange={(e) => setSubnet(e.target.value)} placeholder="172.20.0.0/16" />
            </div>
            <div className="form-row">
              <label>网关 (可选)</label>
              <input value={gateway} onChange={(e) => setGateway(e.target.value)} placeholder="172.20.0.1" />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 16 }}>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, textTransform: 'none' }}>
              <input
                type="checkbox"
                checked={internal}
                onChange={(e) => setInternal(e.target.checked)}
                style={{ width: 13, height: 13 }}
              />
              内部网络（不可访问外网）
            </label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, textTransform: 'none' }}>
              <input
                type="checkbox"
                checked={attachable}
                onChange={(e) => setAttachable(e.target.checked)}
                style={{ width: 13, height: 13 }}
              />
              可附加（允许 swarm 服务外挂）
            </label>
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
