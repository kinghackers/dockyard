import { useEffect, useState } from 'react';
import { X, Loader2, Trash2, HardDrive } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { useConfirm } from '../../utils/useConfirm';
import { useModalKeys } from '../../utils/useModalKeys';
import { t, useT } from '../../i18n';

interface Props {
  /** omit on multi-host surfaces (home): the dialog shows a host picker */
  hostId?: string;
  onClose: () => void;
  onDone: () => void | Promise<void>;
}

type Df = Awaited<ReturnType<typeof window.dockerApi.systemDf>>;

function fmtBytes(n?: number): string {
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

/** Disk cleanup wizard: docker system df + selective prune. */
export function CleanupDialog({ hostId, onClose, onDone }: Props) {
  const t = useT();
  const toast = useAppStore((s) => s.toast);
  const connections = useAppStore((s) => s.connections);
  const statuses = useAppStore((s) => s.statuses);
  const [confirmDialog, confirm] = useConfirm();
  const connectedHosts = connections.filter((c) => statuses[c.id]?.connected);
  const [pickedHost, setPickedHost] = useState(hostId ?? connectedHosts[0]?.id ?? '');
  const host = hostId ?? pickedHost;
  const [df, setDf] = useState<Df | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [danglingImages, setDanglingImages] = useState(true);
  const [stoppedContainers, setStoppedContainers] = useState(false);
  const [unusedNetworks, setUnusedNetworks] = useState(false);
  const [unusedVolumes, setUnusedVolumes] = useState(false);
  const [buildCache, setBuildCache] = useState(false);

  const load = async () => {
    if (!host) return;
    setError(null);
    try {
      setDf(await window.dockerApi.systemDf(host));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host]);

  useModalKeys({ onCancel: onClose, disabled: busy });

  const run = async () => {
    setBusy(true);
    try {
      if (unusedVolumes) {
        const ok = await confirm({
          title: t('删除未使用的数据卷'),
          message: t('未使用的数据卷将被永久删除，卷内数据无法恢复。确认继续？'),
          confirmLabel: t('删除数据卷'),
          danger: true,
        });
        if (!ok) {
          setBusy(false);
          return;
        }
      }
      const res = await window.dockerApi.pruneSystem(host, {
        danglingImages,
        stoppedContainers,
        unusedNetworks,
        unusedVolumes,
        buildCache,
      });
      const parts: string[] = [];
      if (danglingImages) parts.push(t("{p0} 个悬空镜像", { p0: res.imagesDeleted }));
      if (stoppedContainers) parts.push(t("{p0} 个已停止容器", { p0: res.containersDeleted }));
      if (unusedNetworks) parts.push(t("{p0} 个网络", { p0: res.networksDeleted }));
      if (unusedVolumes) parts.push(t("{p0} 个数据卷", { p0: res.volumesDeleted }));
      if (buildCache) parts.push(t("构建缓存 {p0}", { p0: fmtBytes(res.buildCacheBytes) }));
      toast(parts.length ? t("已清理：{p0}", { p0: parts.join('、') }) : t('未选择任何清理项'), parts.length ? 'success' : 'info');
      await onDone();
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const row = (
    checked: boolean,
    onChange: (v: boolean) => void,
    label: string,
    detail: string,
    disabled = false
  ) => (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 10px',
        border: '1px solid var(--border)',
        borderRadius: 4,
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontSize: 12,
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: 13, height: 13 }}
      />
      <span style={{ flex: 1 }}>{label}</span>
      <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>{detail}</span>
    </label>
  );

  return (
    <>
      <div className="modal-backdrop" onClick={busy ? undefined : onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 520 }}>
          <div className="modal-header">
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <HardDrive size={15} /> {t('磁盘清理')}
            </span>
            <button className="btn ghost icon-btn" onClick={onClose}>
              <X size={15} />
            </button>
          </div>
          <div className="modal-body">
            {!hostId && (
              <div className="form-row" style={{ maxWidth: 320 }}>
                <label>{t('Docker 主机')}</label>
                <select value={pickedHost} onChange={(e) => setPickedHost(e.target.value)} disabled={busy}>
                  {connectedHosts.length === 0 && <option value="">{t('（无已连接主机）')}</option>}
                  {connectedHosts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {error ? (
              <div style={{ color: 'var(--error)', fontSize: 12, padding: '8px 0' }}>
                {t('获取磁盘占用失败：{p0}', { p0: error })}
                <button className="btn" style={{ marginLeft: 10, height: 24 }} onClick={() => void load()}>
                  {t('重试')}
                </button>
              </div>
            ) : !host ? (
              <div style={{ padding: '24px 8px', color: 'var(--text-dim)', textAlign: 'center', fontSize: 12 }}>
                {t('没有已连接的 Docker 主机，请先在左侧连接一台主机。')}
              </div>
            ) : !df ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-dim)', padding: 8 }}>
                <Loader2 size={14} className="spinner" /> {t('正在统计磁盘占用…')}
              </div>
            ) : (
              <>
                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 10 }}>
                  {t('共 {p0} 个镜像 / {p1} 个容器 / {p2} 个数据卷，', { p0: df.images, p1: df.containers, p2: df.volumes })}
                  {t('可回收约')} <b style={{ color: 'var(--warning)' }}>{fmtBytes(df.reclaimableBytes)}</b>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {row(
                    danglingImages,
                    setDanglingImages,
                    t('悬空镜像（无标签且未被使用）'),
                    t("{p0} 个 · {p1}", { p0: df.danglingImages, p1: fmtBytes(df.danglingImageBytes) })
                  )}
                  {row(
                    stoppedContainers,
                    setStoppedContainers,
                    t('已停止的容器'),
                    t("{p0} 个 · {p1}", { p0: df.stoppedContainers, p1: fmtBytes(df.stoppedContainerBytes) })
                  )}
                  {row(unusedNetworks, setUnusedNetworks, t('未使用的网络'), t('数量由守护进程决定'))}
                  {row(buildCache, setBuildCache, t('构建缓存（docker build 中间层）'), t('按占用空间回收'))}
                  {row(
                    unusedVolumes,
                    setUnusedVolumes,
                    t('未使用的数据卷（危险）'),
                    t("{p0} 个 · {p1}", { p0: df.unusedVolumes, p1: fmtBytes(df.unusedVolumeBytes) })
                  )}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10, lineHeight: 1.6 }}>
                  {t('清理操作不可撤销；正在运行容器使用的资源不会被删除。')}
                </div>
              </>
            )}
          </div>
          <div className="modal-footer">
            <div style={{ flex: 1 }} />
            <button className="btn" onClick={onClose} disabled={busy}>
              {t('取消')}
            </button>
            <button
              className="btn danger"
              onClick={() => void run()}
              disabled={busy || !df || (!danglingImages && !stoppedContainers && !unusedNetworks && !unusedVolumes && !buildCache)}
            >
              {busy ? <Loader2 size={13} className="spinner" /> : <Trash2 size={13} />} {t('清理')}
            </button>
          </div>
        </div>
      </div>
      {confirmDialog}
    </>
  );
}
