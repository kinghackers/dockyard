import { useState, useEffect } from 'react';
import { X, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import type { ConnectionGroup, ConnectionKind, DockerConnectionConfig } from '../../types/docker';
import { useModalKeys } from '../../utils/useModalKeys';
import { t, useT } from '../../i18n';

interface Props {
  initial: DockerConnectionConfig | null;
  defaultGroupId?: string;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

function newId() {
  return `conn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function ConnectionDialog({ initial, defaultGroupId, onClose, onSaved }: Props) {
  const t = useT();
  const [kind, setKind] = useState<ConnectionKind>(initial?.kind || 'tcp');
  const [name, setName] = useState(initial?.name || '');
  const [groupId, setGroupId] = useState(initial?.groupId || defaultGroupId || '');
  const [groups, setGroups] = useState<ConnectionGroup[]>([]);
  const [host, setHost] = useState(initial?.host || '127.0.0.1');
  const [port, setPort] = useState(initial?.port || 2375);
  const [tls, setTls] = useState(initial?.tls ?? false);
  const [caCertPath, setCaCertPath] = useState(initial?.caCertPath || '');
  const [certPath, setCertPath] = useState(initial?.certPath || '');
  const [keyPath, setKeyPath] = useState(initial?.keyPath || '');
  const [ca, setCa] = useState(initial?.ca || '');
  const [cert, setCert] = useState(initial?.cert || '');
  const [key, setKey] = useState(initial?.key || '');

  const [socketPath, setSocketPath] = useState(initial?.socketPath || '/var/run/docker.sock');

  const [sshHost, setSshHost] = useState(initial?.sshHost || '');
  const [sshPort, setSshPort] = useState(initial?.sshPort || 22);
  const [sshUser, setSshUser] = useState(initial?.sshUser || 'root');
  const [sshPassword, setSshPassword] = useState(initial?.sshPassword || '');
  const [sshPrivateKeyPath, setSshPrivateKeyPath] = useState(initial?.sshPrivateKeyPath || '');
  const [sshPassphrase, setSshPassphrase] = useState(initial?.sshPassphrase || '');
  const [dockerSocketPath, setDockerSocketPath] = useState(
    initial?.dockerSocketPath || '/var/run/docker.sock'
  );

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void window.dockerApi
      .listGroups()
      .then((list) => setGroups(list))
      .catch(() => setGroups([]));
  }, []);

  // 名称留空时按连接目标自动生成（如 tcp-192.168.1.68）
  const autoNameSource = kind === 'ssh' ? sshHost : kind === 'unix' ? socketPath : host;
  const buildConfig = (): DockerConnectionConfig => ({
    id: initial?.id || newId(),
    name: name.trim() || `${kind}-${autoNameSource.trim() || 'docker'}`,
    kind,
    groupId: groupId || undefined,
    host,
    port: Number(port) || undefined,
    tls,
    caCertPath: caCertPath || undefined,
    certPath: certPath || undefined,
    keyPath: keyPath || undefined,
    ca: ca || undefined,
    cert: cert || undefined,
    key: key || undefined,
    socketPath: socketPath || undefined,
    sshHost: sshHost || undefined,
    sshPort: Number(sshPort) || undefined,
    sshUser: sshUser || undefined,
    sshPassword: sshPassword || undefined,
    sshPrivateKeyPath: sshPrivateKeyPath || undefined,
    sshPassphrase: sshPassphrase || undefined,
    dockerSocketPath: dockerSocketPath || undefined,
  });

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await window.dockerApi.testConnection(buildConfig());
      if (res.ok) {
        setTestResult({
          ok: true,
          message: t("连接成功 · Docker {p0} · {p1} 个容器", { p0: res.info?.serverVersion || '', p1: res.info?.containers ?? 0 }),
        });
      } else {
        setTestResult({ ok: false, message: res.error || t('测试失败') });
      }
    } catch (e) {
      setTestResult({ ok: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  };

  const validate = (): string | null => {
    if (kind === 'tcp' && !host.trim()) return t('请填写主机地址');
    if (kind === 'ssh' && !sshHost.trim()) return t('请填写 SSH 主机地址');
    if (kind === 'unix' && !socketPath.trim()) return t('请填写 Unix socket 路径');
    return null;
  };

  const handleSave = async () => {
    const msg = validate();
    if (msg) {
      setTestResult({ ok: false, message: msg });
      return;
    }
    setSaving(true);
    try {
      await window.dockerApi.upsertConnection(buildConfig());
      await onSaved();
    } catch (e) {
      setTestResult({ ok: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };

  useModalKeys({ onCancel: onClose, onSubmit: () => void handleSave(), disabled: saving });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 560 }}>
        <div className="modal-header">
          <span>{initial ? t('编辑连接') : t('添加 Docker 连接')}</span>
          <button className="btn ghost icon-btn" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        <div className="modal-body">
          <div className="form-grid">
            <div className="form-row">
              <label>{t('名称')}</label>
              <input
                value={name}
                autoFocus
                onChange={(e) => setName(e.target.value)}
                placeholder={t('可选，留空自动生成（如 ssh-192.168.1.68）')}
              />
            </div>
            <div className="form-row">
              <label>{t('连接方式')}</label>
              <select value={kind} onChange={(e) => setKind(e.target.value as ConnectionKind)}>
                <option value="tcp">TCP（HTTP/HTTPS）</option>
                <option value="ssh">{t('SSH 隧道')}</option>
                <option value="unix">{t('Unix 套接字')}</option>
              </select>
            </div>
            <div className="form-row">
              <label>{t('所属目录')}</label>
              <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                <option value="">{t('（根目录）')}</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {kind === 'tcp' && (
            <>
              <div className="form-grid">
                <div className="form-row">
                  <label>{t('主机')}</label>
                  <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="192.168.1.68" />
                </div>
                <div className="form-row">
                  <label>{t('端口')}</label>
                  <input
                    type="number"
                    value={port}
                    onChange={(e) => setPort(Number(e.target.value))}
                    placeholder="2375"
                  />
                </div>
              </div>
              <div className="form-row">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, textTransform: 'none' }}>
                  <input
                    type="checkbox"
                    checked={tls}
                    onChange={(e) => setTls(e.target.checked)}
                    style={{ width: 14, height: 14 }}
                  />
                  {t('启用 TLS (https / 双向认证)')}
                </label>
              </div>
              {tls && (
                <>
                  <div className="form-row">
                    <label>{t('CA 证书路径')}</label>
                    <input
                      value={caCertPath}
                      onChange={(e) => setCaCertPath(e.target.value)}
                      placeholder="例：C:\certs\ca.pem"
                    />
                  </div>
                  <div className="form-row">
                    <label>{t('客户端证书路径')}</label>
                    <input
                      value={certPath}
                      onChange={(e) => setCertPath(e.target.value)}
                      placeholder="例：C:\certs\cert.pem"
                    />
                  </div>
                  <div className="form-row">
                    <label>{t('客户端密钥路径')}</label>
                    <input
                      value={keyPath}
                      onChange={(e) => setKeyPath(e.target.value)}
                      placeholder="例：C:\certs\key.pem"
                    />
                  </div>
                  <details style={{ fontSize: 12 }}>
                    <summary style={{ cursor: 'pointer', color: 'var(--text-dim)' }}>{t('或粘贴 PEM 内容')}</summary>
                    <div className="form-row" style={{ marginTop: 8 }}>
                      <label>{t('CA 证书内容')}</label>
                      <textarea rows={3} value={ca} onChange={(e) => setCa(e.target.value)} />
                    </div>
                    <div className="form-row">
                      <label>{t('客户端证书内容')}</label>
                      <textarea rows={3} value={cert} onChange={(e) => setCert(e.target.value)} />
                    </div>
                    <div className="form-row">
                      <label>{t('客户端密钥内容')}</label>
                      <textarea rows={3} value={key} onChange={(e) => setKey(e.target.value)} />
                    </div>
                  </details>
                </>
              )}
            </>
          )}

          {kind === 'unix' && (
            <div className="form-row">
              <label>{t('Socket 路径')}</label>
              <input value={socketPath} onChange={(e) => setSocketPath(e.target.value)} placeholder="/var/run/docker.sock" />
            </div>
          )}

          {kind === 'ssh' && (
            <>
              <div className="form-grid">
                <div className="form-row">
                  <label>{t('SSH 主机')}</label>
                  <input value={sshHost} onChange={(e) => setSshHost(e.target.value)} placeholder="192.168.1.68" />
                </div>
                <div className="form-row">
                  <label>{t('SSH 端口')}</label>
                  <input
                    type="number"
                    value={sshPort}
                    onChange={(e) => setSshPort(Number(e.target.value))}
                    placeholder="22"
                  />
                </div>
              </div>
              <div className="form-grid">
                <div className="form-row">
                  <label>{t('用户名')}</label>
                  <input value={sshUser} onChange={(e) => setSshUser(e.target.value)} placeholder="root" />
                </div>
                <div className="form-row">
                  <label>{t('密码（与密钥二选一）')}</label>
                      <input
                        type="password"
                        value={sshPassword}
                        onChange={(e) => setSshPassword(e.target.value)}
                        placeholder={t('输入 SSH 登录密码')}
                      />
                </div>
              </div>
              <div className="form-grid">
                <div className="form-row">
                  <label>{t('私钥路径')}</label>
                  <input
                    value={sshPrivateKeyPath}
                    onChange={(e) => setSshPrivateKeyPath(e.target.value)}
                    placeholder="C:\Users\xx\.ssh\id_rsa"
                  />
                </div>
                <div className="form-row">
                  <label>{t('私钥密码')}</label>
                  <input
                    type="password"
                    value={sshPassphrase}
                    onChange={(e) => setSshPassphrase(e.target.value)}
                    placeholder={t('私钥未加密则留空')}
                  />
                </div>
              </div>
              <div className="form-row">
                <label>{t('Docker Socket 路径（远程）')}</label>
                <input
                  value={dockerSocketPath}
                  onChange={(e) => setDockerSocketPath(e.target.value)}
                  placeholder="/var/run/docker.sock"
                />
              </div>
            </>
          )}

          {testResult && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 12px',
                borderRadius: 4,
                background: testResult.ok ? 'var(--success-soft)' : 'var(--error-soft)',
                color: testResult.ok ? 'var(--success)' : 'var(--error)',
                fontSize: 12,
              }}
            >
              {testResult.ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
              <span>{testResult.message}</span>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={handleTest} disabled={testing}>
            {testing ? <Loader2 size={14} className="spinner" /> : null}
            {t('测试连接')}
          </button>
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>
            {t('取消')}
          </button>
          <button className="btn primary" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 size={14} className="spinner" /> : null}
            {t('保存')}
          </button>
        </div>
      </div>
    </div>
  );
}
