import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  RefreshCw,
  Trash2,
  Download,
  Search,
  Play,
  ArrowUp,
  ArrowDown,
  Copy,
  Tag,
  Plus,
  Upload,
  Save,
} from 'lucide-react';
import type { ImageSummary } from '../../types/docker';
import { useAppStore } from '../../stores/appStore';
import { reportError } from '../../utils/connection';
import { useConfirm } from '../../utils/useConfirm';
import { fmtBytes } from '../../utils/format';
import { useMultiSelect } from '../../hooks/useMultiSelect';
import { useHotkeys } from '../../utils/useHotkeys';
import { loadUiPref, saveUiPref } from '../../utils/uiPrefs';
import { RunContainerDialog } from '../Containers/RunContainerDialog';
import { ContextMenu, useContextMenu, type ContextMenuItem } from '../common/ContextMenu';
import { ListError, ListLoading } from '../common/ListFeedback';
import { SortableTh } from '../common/SortableTh';
import { TagImageDialog } from './TagImageDialog';
import { ImageHistoryDialog } from './ImageHistoryDialog';
import { CleanupDialog } from './CleanupDialog';

type SortKey = 'tags' | 'id' | 'size' | 'created';

function tagsLabel(img: ImageSummary): string {
  return img.repoTags.length > 0 ? img.repoTags.join(', ') : `<none>:${img.id.slice(7, 19)}`;
}

export function ImageListPage({ hostId }: { hostId: string }) {
  const toast = useAppStore((s) => s.toast);
  const setRefreshing = useAppStore((s) => s.setRefreshing);
  const containersVersion = useAppStore((s) => s.containersVersion);
  const [list, setList] = useState<ImageSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState(() => loadUiPref('images.filter', ''));
  const [selected, setSelected] = useState<string | null>(null);
  const {
    checked,
    toggle: toggleChecked,
    selectAll,
    clear: clearChecked,
    remove: uncheck,
    selectRange,
  } = useMultiSelect();
  const [sortKey, setSortKey] = useState<SortKey>(() => loadUiPref('images.sortKey', 'created'));
  const [sortAsc, setSortAsc] = useState(() => loadUiPref('images.sortAsc', false));
  const [pullName, setPullName] = useState('');
  const [pulling, setPulling] = useState(false);
  const [pullMessage, setPullMessage] = useState('');
  const [pushing, setPushing] = useState<string | null>(null);
  const [pushMessage, setPushMessage] = useState('');
  const [runImage, setRunImage] = useState<string | null>(null);
  const [tagFor, setTagFor] = useState<ImageSummary | null>(null);
  const [historyFor, setHistoryFor] = useState<ImageSummary | null>(null);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDialog, confirm] = useConfirm();
  const pullOffRef = useRef<(() => void) | null>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const ctx = useContextMenu();

  const load = useCallback(async () => {
    setLoading(true);
    setRefreshing(true);
    setError(null);
    try {
      const data = await window.dockerApi.listImages(hostId);
      setList(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [hostId, setRefreshing]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    saveUiPref('images.filter', filter);
  }, [filter]);
  useEffect(() => {
    saveUiPref('images.sortKey', sortKey);
    saveUiPref('images.sortAsc', sortAsc);
  }, [sortKey, sortAsc]);

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

  const filtered = useMemo(() => {
    const rows = list.filter((img) => {
      if (!filter) return true;
      const q = filter.toLowerCase();
      return (
        img.repoTags.some((t) => t.toLowerCase().includes(q)) ||
        img.id.toLowerCase().includes(q)
      );
    });
    const dir = sortAsc ? 1 : -1;
    return [...rows].sort((a, b) => {
      switch (sortKey) {
        case 'tags':
          return dir * tagsLabel(a).localeCompare(tagsLabel(b));
        case 'id':
          return dir * a.id.localeCompare(b.id);
        case 'size':
          return dir * (a.size - b.size);
        case 'created':
          return dir * (a.created - b.created);
        default:
          return 0;
      }
    });
  }, [list, filter, sortKey, sortAsc]);

  const selectedImage = useMemo(
    () => list.find((i) => i.id === selected) || null,
    [list, selected]
  );
  const allChecked = filtered.length > 0 && filtered.every((i) => checked.has(i.id));

  const toggleAll = () => selectAll(allChecked ? [] : filtered.map((i) => i.id));

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else {
      setSortKey(key);
      setSortAsc(key === 'tags' || key === 'id');
    }
  };

  const runOne = (img: ImageSummary) => {
    setRunImage(img.repoTags[0] || img.id.slice(0, 12));
  };

  const pushOne = async (img: ImageSummary) => {
    const name = img.repoTags[0];
    if (!name) {
      toast('该镜像没有仓库标签，请先「打标签」再推送', 'error');
      return;
    }
    if (pushing) return;
    setPushing(name);
    setPushMessage('');
    const off = window.dockerApi.onPushProgress((p) => {
      if (p.name === name) setPushMessage(p.message);
    });
    try {
      await window.dockerApi.pushImage(hostId, name);
      toast(`已推送 ${name}`, 'success');
      await load();
    } catch (e) {
      reportError(e, toast);
    } finally {
      off();
      setPushing(null);
      setPushMessage('');
    }
  };

  const saveOne = async (img: ImageSummary) => {
    const name = img.repoTags[0] || img.id;
    toast(`正在导出 ${name}，大镜像可能需要一些时间…`, 'info');
    try {
      const res = await window.dockerApi.saveImage(hostId, name);
      if (res.ok) {
        toast(`已导出 ${(res.bytes ?? 0).toLocaleString()} 字节 → ${res.path}`, 'success');
      } else if (!res.canceled) {
        toast(res.error || '导出失败', 'error');
      }
    } catch (e) {
      reportError(e, toast);
    }
  };

  const loadFromFile = async () => {
    setPulling(true);
    setPullMessage('正在导入镜像…');
    try {
      const res = await window.dockerApi.loadImage(hostId);
      if (res.ok) {
        toast('镜像导入完成', 'success');
        await load();
      } else if (!res.canceled) {
        toast(res.error || '导入失败', 'error');
      }
    } catch (e) {
      reportError(e, toast);
    } finally {
      setPulling(false);
      setPullMessage('');
    }
  };

  const tagOne = (img: ImageSummary) => setTagFor(img);
  const showHistory = (img: ImageSummary) => setHistoryFor(img);

  const applyTag = async (repo: string, tag: string) => {
    if (!tagFor) return;
    try {
      await window.dockerApi.tagImage(hostId, tagFor.id, repo, tag);
      toast(`已标记 ${repo}:${tag}`, 'success');
      setTagFor(null);
      await load();
    } catch (e) {
      reportError(e, toast);
    }
  };

  const removeOne = async (id: string, label: string) => {
    const ok = await confirm({
      title: '删除镜像',
      message: `确认删除镜像「${label}」？若有容器仍在使用将删除失败。`,
      confirmLabel: '删除',
      danger: true,
    });
    if (!ok) return;
    try {
      await window.dockerApi.removeImage(hostId, id, false);
      toast('镜像已删除', 'success');
      setSelected(null);
      uncheck(id);
      await load();
    } catch (e) {
      reportError(e, toast);
    }
  };

  const removeMany = async (ids: string[]) => {
    const ok = await confirm({
      title: '批量删除镜像',
      message: `确认删除选中的 ${ids.length} 个镜像？正在使用的镜像会删除失败。`,
      confirmLabel: '删除',
      danger: true,
    });
    if (!ok) return;
    let okCount = 0;
    for (const id of ids) {
      try {
        await window.dockerApi.removeImage(hostId, id, false);
        okCount++;
      } catch {
        /* keep going */
      }
    }
    toast(`已删除 ${okCount}/${ids.length} 个镜像`, okCount === ids.length ? 'success' : 'error');
    clearChecked();
    setSelected(null);
    await load();
  };

  useHotkeys({
    'mod+f': () => filterRef.current?.focus(),
    f5: () => void load(),
    'mod+a': () => {
      if (filtered.length === 0) return;
      selectAll(filtered.map((i) => i.id));
    },
    escape: () => clearChecked(),
    arrowdown: () => {
      if (filtered.length === 0) return;
      const idx = selected ? filtered.findIndex((c) => c.id === selected) : -1;
      const next = filtered[Math.min(idx + 1, filtered.length - 1)] ?? filtered[0];
      setSelected(next.id);
    },
    arrowup: () => {
      if (filtered.length === 0) return;
      const idx = selected ? filtered.findIndex((c) => c.id === selected) : filtered.length;
      const next = filtered[Math.max(idx - 1, 0)] ?? filtered[0];
      setSelected(next.id);
    },
    enter: () => {
      if (!selectedImage) return;
      runOne(selectedImage);
    },
    delete: () => {
      const ids = checked.size > 0 ? [...checked] : selected ? [selected] : [];
      if (ids.length === 0) return;
      const first = list.find((i) => i.id === ids[0]);
      void (ids.length === 1 && first
        ? removeOne(ids[0], tagsLabel(first))
        : removeMany(ids));
    },
  });

  const rowMenu = (img: ImageSummary): ContextMenuItem[] => {
    const ids = checked.has(img.id) && checked.size > 1 ? [...checked] : [img.id];
    const multi = ids.length > 1;
    const label = tagsLabel(img);
    return [
      {
        key: 'run',
        label: '运行…',
        icon: <Play size={13} />,
        disabled: multi,
        onSelect: () => runOne(img),
      },
      {
        key: 'tag',
        label: '打标签…',
        icon: <Tag size={13} />,
        disabled: multi,
        onSelect: () => tagOne(img),
      },
      {
        key: 'push',
        label: pushing ? '推送中…' : '推送到仓库…',
        icon: <Upload size={13} />,
        disabled: multi || !!pushing || img.repoTags.length === 0,
        onSelect: () => void pushOne(img),
      },
      {
        key: 'history',
        label: '查看历史…',
        disabled: multi,
        onSelect: () => showHistory(img),
      },
      {
        key: 'save',
        label: '保存到文件…（docker save）',
        icon: <Save size={13} />,
        disabled: multi,
        onSelect: () => void saveOne(img),
      },
      {
        key: 'copy',
        label: '复制镜像 ID',
        icon: <Copy size={13} />,
        disabled: multi,
        onSelect: () => {
          void navigator.clipboard?.writeText(img.id);
          toast('已复制镜像 ID', 'info');
        },
      },
      {
        key: 'copyTag',
        label: '复制仓库:标签',
        icon: <Tag size={13} />,
        disabled: multi || img.repoTags.length === 0,
        onSelect: () => {
          void navigator.clipboard?.writeText(img.repoTags[0]);
          toast('已复制镜像名', 'info');
        },
      },
      { key: 'sep', label: '', separator: true, onSelect: () => {} },
      {
        key: 'del',
        label: multi ? `删除 ${ids.length} 个…` : '删除…',
        icon: <Trash2 size={13} />,
        danger: true,
        onSelect: () => void (multi ? removeMany(ids) : removeOne(img.id, label)),
      },
    ];
  };

  const sortInd = (key: SortKey) =>
    sortKey === key ? (
      <span className="sort-ind">{sortAsc ? <ArrowUp size={11} /> : <ArrowDown size={11} />}</span>
    ) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div className="content-toolbar">
        <button
          className="btn primary"
          disabled={!selectedImage}
          onClick={() => selectedImage && runOne(selectedImage)}
        >
          <Play size={13} /> 运行
        </button>
        <button className="btn" onClick={load} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'spinner' : ''} /> 刷新
        </button>
        <button
          className="btn"
          disabled={!selectedImage}
          onClick={() => selectedImage && tagOne(selectedImage)}
        >
          <Tag size={13} /> 打标签
        </button>
        <button
          className="btn"
          disabled={!selectedImage || !!pushing}
          title="推送到镜像仓库（需先 docker login）"
          onClick={() => selectedImage && void pushOne(selectedImage)}
        >
          <Upload size={13} /> {pushing ? '推送中…' : '推送'}
        </button>
        <button
          className="btn"
          disabled={!selectedImage}
          onClick={() => selectedImage && showHistory(selectedImage)}
        >
          历史
        </button>
        <button
          className="btn danger"
          disabled={!selected}
          onClick={() => {
            if (!selected || !selectedImage) return;
            void removeOne(selected, tagsLabel(selectedImage));
          }}
        >
          <Trash2 size={13} /> 删除
        </button>
        {checked.size > 0 && (
          <>
            <div style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 4px' }} />
            <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>已选 {checked.size}</span>
            <button className="btn danger" onClick={() => void removeMany([...checked])}>
              <Trash2 size={13} /> 批量删除
            </button>
            <button className="btn ghost" onClick={() => clearChecked()}>
              清除选择
            </button>
          </>
        )}
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
        <button className="btn" disabled={pulling} onClick={() => void loadFromFile()} title="从 tar 文件导入镜像（docker load）">
          <Upload size={13} /> 导入
        </button>
        <button className="btn" onClick={() => setCleanupOpen(true)} title="清理悬空镜像、已停止容器、未使用网络/数据卷">
          <Trash2 size={13} /> 清理
        </button>
        <div style={{ position: 'relative' }}>
          <Search size={13} style={{ position: 'absolute', left: 8, top: 8, color: 'var(--text-muted)' }} />
          <input
            ref={filterRef}
            className="search-input"
            style={{ paddingLeft: 26 }}
            placeholder="过滤镜像（Ctrl+F）"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      </div>

      {(pulling && pullMessage) || (pushing && pushMessage) ? (
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
          {pushing ? `推送 ${pushing} · ${pushMessage}` : pullMessage}
        </div>
      ) : null}

      {error && <ListError error={error} onRetry={() => void load()} />}

      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {loading && list.length === 0 && !error ? (
          <ListLoading label="正在加载镜像…" />
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <p>{list.length === 0 ? '暂无镜像' : '没有匹配的镜像'}</p>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 28 }}>
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={toggleAll}
                    style={{ width: 12, height: 12 }}
                  />
                </th>
                <SortableTh label={'仓库:标签'} active={sortKey === 'tags'} asc={sortAsc} onSort={() => toggleSort('tags')} />
                <SortableTh label={'ID'} active={sortKey === 'id'} asc={sortAsc} onSort={() => toggleSort('id')} />
                <SortableTh label={'大小'} active={sortKey === 'size'} asc={sortAsc} onSort={() => toggleSort('size')} />
                <SortableTh label={'创建时间'} active={sortKey === 'created'} asc={sortAsc} onSort={() => toggleSort('created')} />
              </tr>
            </thead>
            <tbody>
              {filtered.map((img) => (
                <tr
                  key={img.id}
                  className={`${selected === img.id ? 'selected' : ''} ${checked.has(img.id) ? 'checked' : ''}`}
                  onClick={(e) => {
                    if (e.ctrlKey || e.metaKey) {
                      toggleChecked(img.id);
                      setSelected(img.id);
                      return;
                    }
                    if (e.shiftKey && selected) {
                      const from = filtered.findIndex((x) => x.id === selected);
                      const to = filtered.findIndex((x) => x.id === img.id);
                      selectRange(
                        filtered.map((x) => x.id),
                        from,
                        to
                      );
                      setSelected(img.id);
                      return;
                    }
                    setSelected(img.id);
                  }}
                  onDoubleClick={() => runOne(img)}
                  onContextMenu={(e) => {
                    setSelected(img.id);
                    if (!checked.has(img.id)) selectAll([img.id]);
                    ctx.open(e, rowMenu(img));
                  }}
                >
                  <td>
                    <input
                      type="checkbox"
                      checked={checked.has(img.id)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggleChecked(img.id)}
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
      {tagFor && (
        <TagImageDialog
          initialRepo={tagFor.repoTags[0]?.split(':')[0] || ''}
          initialTag={tagFor.repoTags[0]?.includes(':') ? tagFor.repoTags[0].split(':').pop() : 'latest'}
          onClose={() => setTagFor(null)}
          onSubmit={applyTag}
        />
      )}
      {historyFor && (
        <ImageHistoryDialog
          hostId={hostId}
          imageId={historyFor.id}
          title={tagsLabel(historyFor)}
          onClose={() => setHistoryFor(null)}
          toast={toast}
        />
      )}
      {cleanupOpen && (
        <CleanupDialog
          hostId={hostId}
          onClose={() => setCleanupOpen(false)}
          onDone={() => void load()}
        />
      )}
      {confirmDialog}
      {ctx.menu && <ContextMenu state={ctx.menu} onClose={ctx.close} />}
    </div>
  );
}
