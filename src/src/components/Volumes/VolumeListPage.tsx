import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, Trash2, Search } from 'lucide-react';
import type { VolumeSummary } from '../../types/docker';
import { useAppStore } from '../../stores/appStore';
import { reportError } from '../../utils/connection';

export function VolumeListPage({ hostId }: { hostId: string }) {
  const { toast } = useAppStore();
  const [list, setList] = useState<VolumeSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await window.dockerApi.listVolumes(hostId);
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

  const filtered = list.filter((v) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return v.name.toLowerCase().includes(q) || v.driver.toLowerCase().includes(q) || v.mountpoint.toLowerCase().includes(q);
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="content-toolbar">
        <button className="btn" onClick={load} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'spinner' : ''} /> 刷新
        </button>
        <button
          className="btn danger"
          disabled={!selected}
          onClick={async () => {
            if (!selected) return;
            if (!confirm(`确认删除数据卷 ${selected}？其中数据将丢失。`)) return;
            try {
              await window.dockerApi.removeVolume(hostId, selected, true);
              toast('数据卷已删除', 'success');
              setSelected(null);
              await load();
            } catch (e) {
              reportError(e, toast);
            }
          }}
        >
          <Trash2 size={13} /> 删除
        </button>
        <div style={{ flex: 1 }} />
        <div style={{ position: 'relative' }}>
          <Search size={13} style={{ position: 'absolute', left: 8, top: 8, color: 'var(--text-muted)' }} />
          <input
            className="search-input"
            style={{ paddingLeft: 26 }}
            placeholder="过滤数据卷"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {filtered.length === 0 ? (
          <div className="empty-state">
            <p>{list.length === 0 ? '暂无数据卷' : '没有匹配的数据卷'}</p>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 28 }}></th>
                <th>名称</th>
                <th>驱动</th>
                <th>挂载点</th>
                <th>作用域</th>
                <th>创建时间</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((v) => (
                <tr
                  key={v.name}
                  className={selected === v.name ? 'selected' : ''}
                  onClick={() => setSelected(v.name)}
                >
                  <td>
                    <input
                      type="radio"
                      checked={selected === v.name}
                      onChange={() => setSelected(v.name)}
                      style={{ width: 12, height: 12 }}
                    />
                  </td>
                  <td style={{ color: 'var(--text-bright)' }}>{v.name}</td>
                  <td>
                    <span className="chip" style={{ background: 'rgba(224,108,117,0.15)', color: 'var(--volume)' }}>
                      {v.driver}
                    </span>
                  </td>
                  <td className="mono" style={{ color: 'var(--text-dim)', fontSize: 11 }}>
                    {v.mountpoint}
                  </td>
                  <td>{v.scope}</td>
                  <td style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                    {v.created ? new Date(v.created).toLocaleString() : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
