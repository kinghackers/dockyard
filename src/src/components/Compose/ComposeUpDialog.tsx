import { useState } from 'react';
import { X, FolderOpen, Loader2, Play } from 'lucide-react';
import { reportError } from '../../utils/connection';
import { useModalKeys } from '../../utils/useModalKeys';
import { t, useT } from '../../i18n';

interface Props {
  hostId: string;
  onClose: () => void;
  onDeployed: () => void | Promise<void>;
  toast: (msg: string, type?: 'info' | 'success' | 'error') => void;
}

/** Deploy a compose file against the selected connection via `docker compose up -d`. */
export function ComposeUpDialog({ hostId, onClose, onDeployed, toast }: Props) {
  const t = useT();
  const [filePath, setFilePath] = useState('');
  const [output, setOutput] = useState('');
  const [busy, setBusy] = useState(false);

  // Esc/backdrop must not dismiss a deploy in flight
  useModalKeys({
    onCancel: onClose,
    onSubmit: () => void deploy(),
    disabled: busy || !filePath.trim(),
  });

  const pick = async () => {
    const p = await window.dockerApi.selectFile([
      { name: t('Compose 文件'), extensions: ['yml', 'yaml'] },
    ]);
    if (p) setFilePath(p);
  };

  const deploy = async () => {
    if (!filePath.trim() || busy) return;
    setBusy(true);
    setOutput(t('正在执行 docker compose up -d …'));
    try {
      const res = await window.dockerApi.composeUp(hostId, filePath.trim());
      setOutput(res.output || (res.ok ? t('(无输出)') : t('部署失败')));
      if (res.ok) {
        toast(t('Compose 项目已部署'), 'success');
        await onDeployed();
      } else {
        toast(t("部署失败（退出码 {p0}）", { p0: res.exitCode ?? '-' }), 'error');
      }
    } catch (e) {
      reportError(e, toast);
      setOutput(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 640, maxWidth: '92vw' }}>
        <div className="modal-header">
          <span>{t('从 Compose 文件部署')}</span>
          <button className="btn ghost icon-btn" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
        <div className="modal-body">
          <div className="form-row">
            <label>compose.yml / docker-compose.yml</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={filePath}
                placeholder={t('例如 {p0}', { p0: 'D:\\projects\\myapp\\docker-compose.yml' })}
                onChange={(e) => setFilePath(e.target.value)}
              />
              <button className="btn" onClick={() => void pick()}>
                <FolderOpen size={13} /> {t('浏览')}
              </button>
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.6 }}>
            {t('将在本机执行')} <span className="mono">{t('docker compose -f &lt;文件&gt; up -d')}</span>，
            {t('并按当前连接的 Docker 端点（DOCKER_HOST）部署。需要已安装 Docker CLI。')}
            {t('SSH 连接依赖本机 ssh 免密；TCP+TLS 会临时写入证书再清理。')}
          </div>

          {output && (
            <pre
              className="log-view"
              style={{
                marginTop: 12,
                maxHeight: 240,
                overflow: 'auto',
                fontSize: 11,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}
            >
              {output}
            </pre>
          )}
        </div>
        <div className="modal-footer">
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose} disabled={busy}>
            {t('关闭')}
          </button>
          <button
            className="btn primary"
            onClick={() => void deploy()}
            disabled={busy || !filePath.trim()}
          >
            {busy ? <Loader2 size={13} className="spinner" /> : <Play size={13} />}
            {t('部署')}
          </button>
        </div>
      </div>
    </div>
  );
}
