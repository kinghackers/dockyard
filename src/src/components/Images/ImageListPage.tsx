import { useEffect, useState, useCallback, useRef } from 'react';
import { RefreshCw, Trash2, Download, Search, Play } from 'lucide-react';
import type { ImageSummary } from '../../types/docker';
import { useAppStore } from '../../stores/appStore';
import { reportError } from '../../utils/connection';
import { useConfirm } from '../../utils/useConfirm';
import { RunContainerDialog } from '../Containers/RunContainerDialog';

function fmtBytes(n: number): string {
  if (!n || n < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

export function ImageListPage({ hostId }: { hostId: string }) {
  const { toast, containersVersion } = useAppStore();
  const [list, setList] = useState<ImageSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [pullName, setPullName] = useState('');
  const [pulling, setPulling] = useState(false);
  const [pullMessage, setPullMessage] = useState('');
  const [runImage, setRunImage] = useState<string | null>(null);
  const [confirmDialog, confirm] = useConfirm();
  const pullOffRef = useRef<(() => void) | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await window.dockerApi.listImages(hostId);
      setList(data);
    } catch (e) {
      reportError(e, toast);
    } finally {
      setLoading(false);
    }
  }, [hostId, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (containersVersion > 0) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containersVersion]);

  const doPull = useCallback(async () => {
    const name = pullName.trim();
    if (!name || pulling) return;
    setPulling(true);
    setPullMessage('');
    pullOffRef.current = window.dockerApi.onPullProgress((p) => {
      if (p.name === name) setPullMessage(p.message);
    });
    try {
      await window.dockerApi.pullImage(hostId, name);
      toast(`已拉取 ${name}`, 'success');
      setPullName('');
      await load();
    } catch (e) {
      reportError(e, toast);
    } finally {
      pullOffRef.current?.();
      pullOffRef.current = null;
      setPulling(false);
      setPullMessage('');
    }
  }, [pullName, pulling, hostId, toast, load]);

  const filtered = list.filter((img) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (
      img.repoTags.some((t) => t.toLowerCase().includes(q)) ||
      img.id.toLowerCase().includes(q)
    );
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="content-toolbar">
        <button className="btn" onClick={load} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'spinner' : ''} /> 刷新
        </button>
        <button
          className="btn primary"
          disabled={!selected}
          onClick={() => {
            if (!selected) return;
            const img = list.find((i) => i.id === selected);
            setRunImage(img?.repoTags[0] || img?.id.slice(0, 12) || selected);
          }}
        >
          <Play size={13} /> 运行
        </button>
        <button
          className="btn danger"
          disabled={!selected}
          onClick={() => {
            if (!selected) return;
            void (async () => {
              const ok = await confirm({
                title: '删除镜像',
                message: '确认删除该镜像？若有容器仍在使用将删除失败。',
                confirmLabel: '删除',
                danger: true,
              });
              if (!ok) return;
              try {
                await window.dockerApi.removeImage(hostId, selected, false);
                toast('镜像已删除', 'success');
                setSelected(null);
                await load();
              } catch (e) {
                reportError(e, toast);
              }
            })();
          }}
        >
          <Trash2 size={13} /> 删除
        </button>
        <div style={{ flex: 1 }} />
        <input
          className="search-input"
          style={{ width: 180 }}
          placeholder="如 nginx:latest"
          value={pullName}
          onChange={(e) => setPullName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && pullName.trim() && !pulling) {
              (e.target as HTMLInputElement).blur();
              void doPull();
            }
          }}
        />
        <button
          className="btn primary"
          disabled={!pullName.trim() || pulling}
          onClick={() => void doPull()}
        >
          <Download size={13} /> {pulling ? '拉取中…' : '拉取镜像'}
        </button>
        <div style={{ position: 'relative' }}>
          <Search size={13} style={{ position: 'absolute', left: 8, top: 8, color: 'var(--text-muted)' }} />
          <input
            className="search-input"
            style={{ paddingLeft: 26 }}
            placeholder="过滤镜像"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      </div>

      {pulling && pullMessage && (
        <div
          style={{
            padding: '6px 12px',
            fontSize: 11,
            color: 'var(--text-dim)',
            background: 'var(--bg-panel-alt)',
            borderTop: '1px solid var(--border)',
            fontFamily: 'var(--font-mono)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {pullMessage}
        </div>
      )}

      <div style={{ flex: 1, overflow: 'auto' }}>
        {filtered.length === 0 ? (
          <div className="empty-state">
            <p>{list.length === 0 ? '暂无镜像' : '没有匹配的镜像'}</p>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 28 }}></th>
                <th>仓库:标签</th>
                <th>ID</th>
                <th>大小</th>
                <th>创建时间</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((img) => (
                <tr
                  key={img.id}
                  className={selected === img.id ? 'selected' : ''}
                  onClick={() => setSelected(img.id)}
                >
                  <td>
                    <input
                      type="radio"
                      checked={selected === img.id}
                      onChange={() => setSelected(img.id)}
                      style={{ width: 12, height: 12 }}
                    />
                  </td>
                  <td>
                    {img.repoTags.length > 0 ? (
                      img.repoTags.map((t) => (
                        <div key={t} style={{ color: 'var(--text-bright)' }}>
                          {t}
                        </div>
                      ))
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>
                        &lt;none&gt;:{img.id.slice(7, 19)}
                      </span>
                    )}
                  </td>
                  <td className="mono" style={{ color: 'var(--text-dim)' }}>
                    {img.id.slice(7, 19)}
                  </td>
                  <td>{fmtBytes(img.size)}</td>
                  <td style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                    {new Date(img.created * 1000).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {runImage && (
        <RunContainerDialog
          hostId={hostId}
          initialImage={runImage}
          onClose={() => setRunImage(null)}
          onCreated={async () => {
            setRunImage(null);
            toast('容器已创建并启动', 'success');
          }}
        />
      )}
      {confirmDialog}
    </div>
  );
}
