import { Fragment, useEffect, useState, useCallback } from 'react';
import { RefreshCw, Trash2, Search, Plus } from 'lucide-react';
import type { NetworkSummary } from '../../types/docker';
import { useAppStore } from '../../stores/appStore';
import { reportError } from '../../utils/connection';
import { useConfirm } from '../../utils/useConfirm';
import { localizeNetworkDriver, localizeScope } from '../../utils/localize';
import { CreateNetworkDialog } from './CreateNetworkDialog';

export function NetworkListPage({ hostId }: { hostId: string }) {
  const { toast, containersVersion } = useAppStore();
  const [list, setList] = useState<NetworkSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmDialog, confirm] = useConfirm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await window.dockerApi.listNetworks(hostId);
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

  const filtered = list.filter((n) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return n.name.toLowerCase().includes(q) || n.id.toLowerCase().includes(q) || n.driver.toLowerCase().includes(q);
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="content-toolbar">
        <button className="btn primary" onClick={() => setCreateOpen(true)}>
          <Plus size={13} /> 创建网络
        </button>
        <button className="btn" onClick={load} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'spinner' : ''} /> 刷新
        </button>
        <button
          className="btn danger"
          disabled={!selected}
          onClick={() => {
            if (!selected) return;
            void (async () => {
              const ok = await confirm({
                title: '删除网络',
                message: '确认删除该网络？已连接的容器将被断开。',
                confirmLabel: '删除',
                danger: true,
              });
              if (!ok) return;
              try {
                await window.dockerApi.removeNetwork(hostId, selected);
                toast('网络已删除', 'success');
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
        <div style={{ position: 'relative' }}>
          <Search size={13} style={{ position: 'absolute', left: 8, top: 8, color: 'var(--text-muted)' }} />
          <input
            className="search-input"
            style={{ paddingLeft: 26 }}
            placeholder="过滤网络"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {filtered.length === 0 ? (
          <div className="empty-state">
            <p>{list.length === 0 ? '暂无网络' : '没有匹配的网络'}</p>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 28 }}></th>
                <th>名称</th>
                <th>ID</th>
                <th>驱动</th>
                <th>作用域</th>
                <th>子网</th>
                <th>容器</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((n) => (
                <Fragment key={n.id}>
                  <tr
                    className={selected === n.id ? 'selected' : ''}
                    onClick={() => setSelected(n.id)}
                    onDoubleClick={() => setExpanded(expanded === n.id ? null : n.id)}
                  >
                    <td>
                      <input
                        type="radio"
                        checked={selected === n.id}
                        onChange={() => setSelected(n.id)}
                        style={{ width: 12, height: 12 }}
                      />
                    </td>
                    <td style={{ color: 'var(--text-bright)' }}>{n.name}</td>
                    <td className="mono" style={{ color: 'var(--text-dim)' }}>
                      {n.id.slice(0, 12)}
                    </td>
                    <td>
                      <span
                        className="chip"
                        style={{ background: 'rgba(198,120,221,0.15)', color: 'var(--network)' }}
                        title={n.driver}
                      >
                        {localizeNetworkDriver(n.driver)}
                      </span>
                    </td>
                    <td>{localizeScope(n.scope)}</td>
                    <td className="mono">{n.subnet || '-'}</td>
                    <td>
                      <button
                        className="btn ghost"
                        style={{ height: 22, fontSize: 11 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpanded(expanded === n.id ? null : n.id);
                        }}
                      >
                        {n.containers.length} 个
                      </button>
                    </td>
                  </tr>
                  {expanded === n.id && (
                    <tr style={{ cursor: 'default' }}>
                      <td colSpan={7} style={{ background: 'var(--bg-panel-alt)' }}>
                        {n.containers.length === 0 ? (
                          <div style={{ color: 'var(--text-muted)', fontSize: 11, padding: 4 }}>
                            该网络上没有已连接的容器
                          </div>
                        ) : (
                          <table className="table" style={{ background: 'transparent' }}>
                            <thead>
                              <tr>
                                <th>容器</th>
                                <th>IPv4</th>
                                <th>IPv6</th>
                                <th>MAC</th>
                              </tr>
                            </thead>
                            <tbody>
                              {n.containers.map((c) => (
                                <tr key={c.name} style={{ cursor: 'default' }}>
                                  <td>{c.name}</td>
                                  <td className="mono">{c.ipv4 || '-'}</td>
                                  <td className="mono">{c.ipv6 || '-'}</td>
                                  <td className="mono">{c.mac || '-'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {createOpen && (
        <CreateNetworkDialog
          hostId={hostId}
          onClose={() => setCreateOpen(false)}
          onCreated={async () => {
            setCreateOpen(false);
            toast('网络已创建', 'success');
            await load();
          }}
        />
      )}
      {confirmDialog}
    </div>
  );
}
