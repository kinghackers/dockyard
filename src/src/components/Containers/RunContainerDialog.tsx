import { useEffect, useMemo, useState } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import type {
  CreateContainerOptions,
  ImageSummary,
  NetworkSummary,
  PortMapping,
  VolumeMountSpec,
} from '../../types/docker';
import { useModalKeys } from '../../utils/useModalKeys';
import { t, useT } from '../../i18n';

interface Props {
  hostId: string;
  /** pre-selected image (e.g. from "Run" on an image row) */
  initialImage?: string;
  onClose: () => void;
  onCreated: (containerId: string) => void | Promise<void>;
}

interface PairRow {
  key: string;
  value: string;
}

const RESTART_POLICIES = [
  { value: 'no', label: t('不自动重启') },
  { value: 'on-failure', label: t('失败时重启') },
  { value: 'always', label: t('总是重启') },
  { value: 'unless-stopped', label: t('除非手动停止') },
] as const;

export function RunContainerDialog({ hostId, initialImage, onClose, onCreated }: Props) {
  const t = useT();
  const [images, setImages] = useState<ImageSummary[]>([]);
  const [networks, setNetworks] = useState<NetworkSummary[]>([]);
  const [image, setImage] = useState(initialImage || '');
  const [name, setName] = useState('');
  const [cmd, setCmd] = useState('');
  const [env, setEnv] = useState<PairRow[]>([{ key: '', value: '' }]);
  const [ports, setPorts] = useState<PortMapping[]>([{ privatePort: 80, publicPort: 8080, type: 'tcp' }]);
  const [volumes, setVolumes] = useState<VolumeMountSpec[]>([{ source: '', destination: '' }]);
  const [network, setNetwork] = useState('');
  const [restartPolicy, setRestartPolicy] = useState<CreateContainerOptions['restartPolicy']>('unless-stopped');
  const [workingDir, setWorkingDir] = useState('');
  const [user, setUser] = useState('');
  const [privileged, setPrivileged] = useState(false);
  const [autoRemove, setAutoRemove] = useState(false);
  const [startNow, setStartNow] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [imgs, nets] = await Promise.all([
          window.dockerApi.listImages(hostId),
          window.dockerApi.listNetworks(hostId),
        ]);
        if (cancelled) return;
        setImages(imgs);
        setNetworks(nets);
        if (!initialImage && imgs.length > 0) {
          setImage(imgs[0].repoTags[0] || imgs[0].id.slice(0, 12));
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hostId, initialImage]);

  const imageOptions = useMemo(() => {
    const tags = images.flatMap((i) => (i.repoTags.length ? i.repoTags : [i.id.slice(0, 12)]));
    if (image && !tags.includes(image)) tags.unshift(image);
    return tags;
  }, [images, image]);

  const buildOptions = (): CreateContainerOptions => {
    const cleanEnv = env.filter((e) => e.key.trim()).map((e) => `${e.key.trim()}=${e.value}`);
    const cleanPorts: PortMapping[] = ports
      .filter((p) => p.privatePort > 0)
      .map((p) => ({
        privatePort: p.privatePort,
        publicPort: p.publicPort && p.publicPort > 0 ? p.publicPort : undefined,
        type: p.type || 'tcp',
        hostIp: p.hostIp?.trim() || undefined,
      }));
    const cleanVolumes: VolumeMountSpec[] = volumes
      .filter((v) => v.source.trim() && v.destination.trim())
      .map((v) => ({
        source: v.source.trim(),
        destination: v.destination.trim(),
        readOnly: v.readOnly || undefined,
      }));
    const cmdParts = cmd.trim() ? cmd.trim().split(/\s+/) : [];

    return {
      image: image.trim(),
      name: name.trim() || undefined,
      cmd: cmdParts.length ? cmdParts : undefined,
      env: cleanEnv.length ? cleanEnv : undefined,
      ports: cleanPorts.length ? cleanPorts : undefined,
      volumes: cleanVolumes.length ? cleanVolumes : undefined,
      network: network || undefined,
      restartPolicy,
      workingDir: workingDir.trim() || undefined,
      user: user.trim() || undefined,
      privileged: privileged || undefined,
      autoRemove: autoRemove || undefined,
    };
  };

  const handleCreate = async () => {
    if (!image.trim()) {
      setError(t('请选择或输入镜像'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const id = await window.dockerApi.createContainer(hostId, buildOptions(), startNow);
      await onCreated(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  useModalKeys({ onCancel: onClose, onSubmit: () => void handleCreate(), disabled: saving });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 640 }}>
        <div className="modal-header">
          <span>{t('创建并运行容器')}</span>
          <button className="btn ghost icon-btn" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        <div className="modal-body">
          <div className="form-grid">
            <div className="form-row">
              <label>{t('镜像 *')}</label>
              <input
                list="run-container-images"
                value={image}
                onChange={(e) => setImage(e.target.value)}
                placeholder="nginx:latest"
              />
              <datalist id="run-container-images">
                {imageOptions.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </div>
            <div className="form-row">
              <label>{t('容器名称')}</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('留空自动生成')} />
            </div>
          </div>

          <div className="form-grid">
            <div className="form-row">
              <label>{t('启动命令')}</label>
              <input value={cmd} onChange={(e) => setCmd(e.target.value)} placeholder={t('留空使用镜像默认 CMD')} />
            </div>
            <div className="form-row">
              <label>{t('网络')}</label>
              <select value={network} onChange={(e) => setNetwork(e.target.value)}>
                <option value="">{t('默认（桥接）')}</option>
                {networks.map((n) => (
                  <option key={n.id} value={n.name}>
                    {n.name}（{n.driver}）
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-grid">
            <div className="form-row">
              <label>{t('重启策略')}</label>
              <select
                value={restartPolicy || 'no'}
                onChange={(e) => setRestartPolicy(e.target.value as CreateContainerOptions['restartPolicy'])}
              >
                {RESTART_POLICIES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <label>{t('工作目录')}</label>
              <input value={workingDir} onChange={(e) => setWorkingDir(e.target.value)} placeholder="/app" />
            </div>
          </div>

          <div className="form-grid">
            <div className="form-row">
              <label>{t('用户')}</label>
              <input value={user} onChange={(e) => setUser(e.target.value)} placeholder="root" />
            </div>
            <div className="form-row">
              <label>{t('选项')}</label>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', paddingTop: 4 }}>
                <label style={{ display: 'flex', gap: 6, alignItems: 'center', textTransform: 'none', fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={startNow}
                    onChange={(e) => setStartNow(e.target.checked)}
                    style={{ width: 13, height: 13 }}
                  />
                  {t('创建后启动')}
                </label>
                <label style={{ display: 'flex', gap: 6, alignItems: 'center', textTransform: 'none', fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={privileged}
                    onChange={(e) => setPrivileged(e.target.checked)}
                    style={{ width: 13, height: 13 }}
                  />
                  {t('特权')}
                </label>
                <label style={{ display: 'flex', gap: 6, alignItems: 'center', textTransform: 'none', fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={autoRemove}
                    onChange={(e) => setAutoRemove(e.target.checked)}
                    style={{ width: 13, height: 13 }}
                  />
                  {t('退出后删除')}
                </label>
              </div>
            </div>
          </div>

          {/* ports */}
          <div className="form-row">
            <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              {t('端口映射')}
              <button
                className="btn ghost"
                style={{ height: 22, fontSize: 11 }}
                onClick={() => setPorts([...ports, { privatePort: 80, publicPort: 0, type: 'tcp' }])}
              >
                <Plus size={12} /> {t('添加')}
              </button>
            </label>
            {ports.map((p, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 28px', gap: 6 }}>
                <input
                  type="number"
                  value={p.publicPort || ''}
                  onChange={(e) => {
                    const next = [...ports];
                    next[i] = { ...p, publicPort: Number(e.target.value) || undefined };
                    setPorts(next);
                  }}
                  placeholder={t('主机端口')}
                />
                <input
                  type="number"
                  value={p.privatePort || ''}
                  onChange={(e) => {
                    const next = [...ports];
                    next[i] = { ...p, privatePort: Number(e.target.value) || 0 };
                    setPorts(next);
                  }}
                  placeholder={t('容器端口')}
                />
                <select
                  value={p.type}
                  onChange={(e) => {
                    const next = [...ports];
                    next[i] = { ...p, type: e.target.value };
                    setPorts(next);
                  }}
                >
                  <option value="tcp">tcp</option>
                  <option value="udp">udp</option>
                </select>
                <button
                  className="btn ghost icon-btn"
                  onClick={() => setPorts(ports.filter((_, j) => j !== i))}
                  title={t('删除')}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>

          {/* volumes */}
          <div className="form-row">
            <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              {t('卷 / 挂载')}
              <button
                className="btn ghost"
                style={{ height: 22, fontSize: 11 }}
                onClick={() => setVolumes([...volumes, { source: '', destination: '' }])}
              >
                <Plus size={12} /> {t('添加')}
              </button>
            </label>
            {volumes.map((v, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto 28px', gap: 6 }}>
                <input
                  value={v.source}
                  onChange={(e) => {
                    const next = [...volumes];
                    next[i] = { ...v, source: e.target.value };
                    setVolumes(next);
                  }}
                  placeholder={t('主机路径或卷名')}
                />
                <input
                  value={v.destination}
                  onChange={(e) => {
                    const next = [...volumes];
                    next[i] = { ...v, destination: e.target.value };
                    setVolumes(next);
                  }}
                  placeholder={t('容器路径')}
                />
                <label
                  style={{
                    display: 'flex',
                    gap: 4,
                    alignItems: 'center',
                    fontSize: 11,
                    color: 'var(--text-dim)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={!!v.readOnly}
                    onChange={(e) => {
                      const next = [...volumes];
                      next[i] = { ...v, readOnly: e.target.checked };
                      setVolumes(next);
                    }}
                    style={{ width: 12, height: 12 }}
                  />
                  {t('只读')}
                </label>
                <button
                  className="btn ghost icon-btn"
                  onClick={() => setVolumes(volumes.filter((_, j) => j !== i))}
                  title={t('删除')}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>

          {/* env */}
          <div className="form-row">
            <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              {t('环境变量')}
              <button
                className="btn ghost"
                style={{ height: 22, fontSize: 11 }}
                onClick={() => setEnv([...env, { key: '', value: '' }])}
              >
                <Plus size={12} /> {t('添加')}
              </button>
            </label>
            {env.map((e, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 28px', gap: 6 }}>
                <input
                  value={e.key}
                  onChange={(ev) => {
                    const next = [...env];
                    next[i] = { ...e, key: ev.target.value };
                    setEnv(next);
                  }}
                  placeholder={t('变量名')}
                />
                <input
                  value={e.value}
                  onChange={(ev) => {
                    const next = [...env];
                    next[i] = { ...e, value: ev.target.value };
                    setEnv(next);
                  }}
                  placeholder={t('变量值')}
                />
                <button
                  className="btn ghost icon-btn"
                  onClick={() => setEnv(env.filter((_, j) => j !== i))}
                  title={t('删除')}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
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
          <button className="btn primary" onClick={handleCreate} disabled={saving || !image.trim()}>
            {saving ? t('创建中…') : startNow ? t('创建并运行') : t('创建')}
          </button>
        </div>
      </div>
    </div>
  );
}
