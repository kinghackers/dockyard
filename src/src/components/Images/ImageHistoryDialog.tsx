import { useEffect, useState } from 'react';
import { X, Loader2, Copy, Check } from 'lucide-react';
import type { ImageDetail } from '../../types/docker';
import { reportError } from '../../utils/connection';
import { useModalKeys } from '../../utils/useModalKeys';

function fmtBytes(n?: number): string {
  if (n == null || n < 0) return '-';
  if (n === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

interface Props {
  hostId: string;
  imageId: string;
  title: string;
  onClose: () => void;
  toast: (msg: string, type?: 'info' | 'success' | 'error') => void;
}

/** Layer-by-layer build history for an image. */
export function ImageHistoryDialog({ hostId, imageId, title, onClose, toast }: Props) {
  const [detail, setDetail] = useState<ImageDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useModalKeys({ onCancel: onClose });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const d = await window.dockerApi.inspectImage(hostId, imageId);
        if (!cancelled) setDetail(d);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hostId, imageId]);

  const copyHistory = () => {
    if (!detail) return;
    const text = detail.history
      .map((h) => `${h.created || ''} ${fmtBytes(h.size)}  ${h.createdBy || ''}`)
      .join('\n');
    void navigator.clipboard?.writeText(text);
    setCopied(true);
    toast('已复制构建历史', 'info');
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 720, maxWidth: '90vw' }}>
        <div className="modal-header">
          <span>镜像历史 · {title}</span>
          <button className="btn ghost icon-btn" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
        <div className="modal-body" style={{ maxHeight: '60vh', overflow: 'auto' }}>
          {!detail && !error && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-dim)' }}>
              <Loader2 size={14} className="spinner" /> 加载中…
            </div>
          )}
          {error && (
            <div style={{ padding: 8, borderRadius: 4, background: 'var(--error-soft)', color: 'var(--error)' }}>
              {error}
            </div>
          )}
          {detail && (
            <>
              <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 12, lineHeight: 1.6 }}>
                <div>
                  ID <span className="mono">{detail.id.slice(0, 19)}</span>
                  {detail.architecture ? ` · ${detail.architecture}` : ''}
                  {detail.os ? `/${detail.os}` : ''} · {fmtBytes(detail.size)}
                </div>
                <div>创建于 {detail.created ? new Date(detail.created).toLocaleString() : '-'}</div>
                {detail.author ? <div>作者 {detail.author}</div> : null}
                {detail.configEntrypoint?.length ? (
                  <div className="mono">ENTRYPOINT {detail.configEntrypoint.join(' ')}</div>
                ) : null}
                {detail.configCmd ? <div className="mono">CMD {detail.configCmd}</div> : null}
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 6,
                  fontSize: 12,
                  color: 'var(--text-bright)',
                }}
              >
                <strong>构建层（{detail.history.length}）</strong>
                <button className="btn ghost" style={{ marginLeft: 'auto', height: 24 }} onClick={copyHistory}>
                  {copied ? <Check size={12} /> : <Copy size={12} />} 复制
                </button>
              </div>

              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 150 }}>创建时间</th>
                    <th style={{ width: 80 }}>大小</th>
                    <th>指令</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.history.map((h, i) => (
                    <tr key={i} style={{ cursor: 'default' }}>
                      <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {h.created ? new Date(h.created).toLocaleString() : '-'}
                      </td>
                      <td className="mono" style={{ fontSize: 11 }}>
                        {h.emptyLayer ? '—' : fmtBytes(h.size)}
                      </td>
                      <td
                        className="mono"
                        style={{
                          fontSize: 11,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-all',
                          color: 'var(--text-dim)',
                        }}
                      >
                        {h.createdBy || h.comment || '(空层)'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
        <div className="modal-footer">
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
