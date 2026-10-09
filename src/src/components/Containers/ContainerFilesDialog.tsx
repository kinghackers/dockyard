import { useCallback, useEffect, useState } from 'react';
import { X, Folder, File as FileIcon, RefreshCw, ArrowUp, Download, Upload } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { useModalKeys } from '../../utils/useModalKeys';
import { t, useT } from '../../i18n';

interface Props {
  hostId: string;
  containerId: string;
  onClose: () => void;
}

function fmtBytes(n?: number): string {
  if (!n || n < 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

/**
 * Browse a container's filesystem: navigate directories, download single
 * files, upload into the current directory (docker cp-style transfers).
 */
export function ContainerFilesDialog({ hostId, containerId, onClose }: Props) {
  const t = useT();
  const toast = useAppStore((s) => s.toast);
  const [dir, setDir] = useState('/');
  const [entries, setEntries] = useState<{ name: string; dir: boolean }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useModalKeys({ onCancel: onClose });

  const load = useCallback(
    async (target: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await window.dockerApi.listContainerFiles(hostId, containerId, target);
        setDir(res.path);
        setEntries(res.entries);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [hostId, containerId]
  );

  useEffect(() => {
    void load('/');
  }, [load]);

  const crumbs = dir.split('/').filter(Boolean);

  const download = async (name: string) => {
    try {
      const res = await window.dockerApi.downloadContainerFile(hostId, containerId, `${dir}/${name}`);
      if (res.ok) {
        toast(t("已下载 {p0}（{p1}）→ {p2}", { p0: name, p1: fmtBytes(res.bytes), p2: res.path }), 'success');
      } else if (!res.canceled) {
        toast(res.error || t('下载失败'), 'error');
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  const upload = async () => {
    try {
      const res = await window.dockerApi.uploadContainerFile(hostId, containerId, dir);
      if (res.ok) {
        toast(`已上传到 ${dir}/${res.path?.replace(/^.*\//, '')}`, 'success');
        await load(dir);
      } else if (!res.canceled) {
        toast(res.error || t('上传失败'), 'error');
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 640 }}>
        <div className="modal-header">
          <span>{t('容器文件 ·')}{containerId.slice(0, 12)}</span>
          <button className="btn ghost icon-btn" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
        <div className="modal-body" style={{ gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <button className="btn ghost icon-btn" title="返回上级" onClick={() => void load(crumbs.length > 1 ? `/${crumbs.slice(0, -1).join('/')}` : '/')} style={{ width: 24, height: 24 }}>
              <ArrowUp size={13} />
            </button>
            <button className="btn ghost icon-btn" title={t('刷新')} onClick={() => void load(dir)} disabled={loading} style={{ width: 24, height: 24 }}>
              <RefreshCw size={13} className={loading ? 'spinner' : ''} />
            </button>
            <span className="mono" style={{ fontSize: 12, color: 'var(--text-bright)', wordBreak: 'break-all' }}>
              <span
                style={{ cursor: 'pointer', color: 'var(--text-link)' }}
                onClick={() => void load('/')}
              >
                /
              </span>
              {crumbs.map((c, i) => (
                <span key={i}>
                  <span
                    style={{ cursor: 'pointer' }}
                    onClick={() => void load(`/${crumbs.slice(0, i + 1).join('/')}`)}
                  >
                    {c}
                  </span>
                  {i < crumbs.length - 1 ? '/' : ''}
                </span>
              ))}
            </span>
            <div style={{ flex: 1 }} />
            <button className="btn" onClick={() => void upload()} title={t('上传文件到当前目录')}>
              <Upload size={13} /> 上传
            </button>
          </div>

          {error ? (
            <div className="list-error" style={{ margin: 0 }}>
              <span style={{ flex: 1 }}>{error}</span>
              <button className="btn" style={{ height: 24 }} onClick={() => void load(dir)}>
                {t('重试')}
              </button>
            </div>
          ) : loading && entries.length === 0 ? (
            <div style={{ padding: 20, color: 'var(--text-dim)', fontSize: 12, textAlign: 'center' }}>
              {t('正在读取目录…')}
            </div>
          ) : (
            <div style={{ border: '1px solid var(--border)', borderRadius: 4, maxHeight: '55vh', overflow: 'auto' }}>
              {entries.length === 0 && (
                <div style={{ padding: 16, color: 'var(--text-muted)', fontSize: 12 }}>{t('空目录')}</div>
              )}
              {entries.map((e) => (
                <div
                  key={e.name}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '5px 10px',
                    fontSize: 12,
                    borderBottom: '1px solid var(--border)',
                  }}
                >
                  {e.dir ? (
                    <Folder size={13} color="var(--warning)" />
                  ) : (
                    <FileIcon size={13} color="var(--text-muted)" />
                  )}
                  <span
                    className="mono"
                    style={{
                      flex: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      cursor: e.dir ? 'pointer' : 'default',
                      color: e.dir ? 'var(--text-link)' : 'var(--text)',
                    }}
                    onClick={() => e.dir && void load(`${dir === '/' ? '' : dir}/${e.name}`)}
                    title={e.dir ? t('进入目录') : e.name}
                  >
                    {e.name}
                  </span>
                  {!e.dir && (
                    <button
                      className="btn ghost icon-btn"
                      title={t('下载到本机')}
                      style={{ width: 22, height: 22 }}
                      onClick={() => void download(e.name)}
                    >
                      <Download size={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {t('目录支持导航；文件可下载到本机、可上传到当前目录。需要容器内有 sh。')}
          </div>
        </div>
      </div>
    </div>
  );
}
