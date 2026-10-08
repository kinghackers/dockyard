import { useState } from 'react';
import { X, Download, Upload, Loader2 } from 'lucide-react';
import type { ConnectionGroup, DockerConnectionConfig } from '../../types/docker';
import { reportError } from '../../utils/connection';
import { useModalKeys } from '../../utils/useModalKeys';

interface Props {
  connections: DockerConnectionConfig[];
  groups: ConnectionGroup[];
  onClose: () => void;
  onImported: () => void | Promise<void>;
  toast: (msg: string, type?: 'info' | 'success' | 'error') => void;
}

type BackupFile = {
  app: 'docker-manager';
  version: 1;
  exportedAt: string;
  includeSecrets: boolean;
  groups: ConnectionGroup[];
  connections: DockerConnectionConfig[];
};

const SECRET_FIELDS: (keyof DockerConnectionConfig)[] = [
  'sshPassword',
  'sshPassphrase',
  'key',
  'cert',
];

function stripSecrets(cfg: DockerConnectionConfig): DockerConnectionConfig {
  const out = { ...cfg };
  for (const f of SECRET_FIELDS) delete out[f];
  return out;
}

/** Backup / restore connection configs and folders as a JSON file. */
export function ConnectionBackupDialog({
  connections,
  groups,
  onClose,
  onImported,
  toast,
}: Props) {
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [busy, setBusy] = useState(false);

  useModalKeys({ onCancel: onClose, disabled: busy });

  const exportJson = () => {
    const payload: BackupFile = {
      app: 'docker-manager',
      version: 1,
      exportedAt: new Date().toISOString(),
      includeSecrets,
      groups,
      connections: connections.map((c) => (includeSecrets ? c : stripSecrets(c))),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `docker-manager-connections-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast(includeSecrets ? '已导出（含敏感信息，请妥善保管）' : '已导出（不含密码/密钥）', 'success');
    onClose();
  };

  const importJson = async () => {
    const path = await window.dockerApi.selectFile([
      { name: '连接备份', extensions: ['json'] },
    ]);
    if (!path) return;
    setBusy(true);
    try {
      const text = await window.dockerApi.readTextFile(path);
      const data = JSON.parse(text) as BackupFile;
      if (!data || !Array.isArray(data.connections)) {
        throw new Error('文件格式不正确：缺少 connections 数组');
      }
      const importedGroups = Array.isArray(data.groups) ? data.groups : [];
      for (const g of importedGroups) {
        if (g?.id && g.name) await window.dockerApi.upsertGroup({ id: g.id, name: g.name });
      }
      let n = 0;
      for (const c of data.connections) {
        if (!c?.id) continue;
        await window.dockerApi.upsertConnection(c);
        n++;
      }
      toast(`已导入 ${n} 个连接、${importedGroups.length} 个目录`, 'success');
      if (!data.includeSecrets) {
        toast('备份不含密码/密钥，请编辑连接补全', 'info');
      }
      await onImported();
      onClose();
    } catch (e) {
      reportError(e, toast);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 480 }}>
        <div className="modal-header">
          <span>连接配置备份</span>
          <button className="btn ghost icon-btn" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
        <div className="modal-body">
          <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.7 }}>
            将当前 {connections.length} 个连接、{groups.length} 个目录导出为 JSON，或从备份文件恢复。
            恢复时按 ID 合并：同 ID 覆盖，新 ID 追加。
          </div>

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginTop: 14,
              fontSize: 12,
              color: 'var(--text)',
            }}
          >
            <input
              type="checkbox"
              checked={includeSecrets}
              onChange={(e) => setIncludeSecrets(e.target.checked)}
              style={{ width: 14, height: 14 }}
            />
            导出时包含 SSH 密码 / TLS 私钥
          </label>
          {includeSecrets && (
            <div
              style={{
                marginTop: 8,
                padding: '8px 10px',
                borderRadius: 4,
                background: 'rgba(217,164,6,0.12)',
                border: '1px solid rgba(217,164,6,0.35)',
                color: 'var(--warning)',
                fontSize: 11,
                lineHeight: 1.6,
              }}
            >
              明文敏感信息。仅在可信环境导出/传输，用完请删除备份文件。
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={() => void importJson()} disabled={busy}>
            {busy ? <Loader2 size={13} className="spinner" /> : <Upload size={13} />} 导入
          </button>
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>
            关闭
          </button>
          <button className="btn primary" onClick={exportJson}>
            <Download size={13} /> 导出
          </button>
        </div>
      </div>
    </div>
  );
}
