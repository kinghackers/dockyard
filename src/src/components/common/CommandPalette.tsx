import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Search,
  Container as ContainerIcon,
  Image as ImageIcon,
  Network,
  Database,
  Layers,
  LayoutDashboard,
  Box,
} from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { useHotkeys } from '../../utils/useHotkeys';
import type { OpenTab } from '../../types/docker';
import { t, useT } from '../../i18n';

interface Item {
  id: string;
  label: string;
  hint: string;
  icon: ReactNode;
  run: () => void;
}

const MAX_ITEMS = 60;

/**
 * Ctrl+P / Ctrl+K command palette: jump to any connected host's views or
 * straight to a container's detail page by typing a few characters.
 */
export function CommandPalette() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useHotkeys({
    'mod+p': () => setOpen((v) => !v),
    'mod+k': () => setOpen((v) => !v),
  });

  const connections = useAppStore((s) => s.connections);
  const statuses = useAppStore((s) => s.statuses);
  const containersByHost = useAppStore((s) => s.containersByHost);

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    // per-host dashboards become closable session tabs; list/detail views are
    // routed to the main surface (closable forced off there) inside openTab
    const go = (tab: Omit<OpenTab, 'closable'>) =>
      useAppStore.getState().openTab(tab as OpenTab);

    const nav: { kind: OpenTab['kind']; label: string; icon: ReactNode }[] = [
      { kind: 'dashboard', label: t('仪表板'), icon: <LayoutDashboard size={14} /> },
      { kind: 'containers', label: t('容器列表'), icon: <Box size={14} /> },
      { kind: 'images', label: t('镜像列表'), icon: <ImageIcon size={14} /> },
      { kind: 'networks', label: t('网络列表'), icon: <Network size={14} /> },
      { kind: 'volumes', label: t('数据卷列表'), icon: <Database size={14} /> },
      { kind: 'compose', label: t('Compose 项目'), icon: <Layers size={14} /> },
    ];

    for (const c of connections) {
      if (!statuses[c.id]?.connected) continue;
      const host = c.name || c.id;
      for (const n of nav) {
        out.push({
          id: `nav:${n.kind}:${c.id}`,
          label: `${n.label} · ${host}`,
          hint: t('导航'),
          icon: n.icon,
          run: () =>
            go({
              id: `${n.kind}:${c.id}`,
              title: `${n.label} · ${host}`,
              kind: n.kind,
              hostId: c.id,
            }),
        });
      }
    }

    for (const [hostId, list] of Object.entries(containersByHost)) {
      const host = connections.find((c) => c.id === hostId)?.name || hostId;
      for (const c of list) {
        out.push({
          id: `ct:${hostId}:${c.id}`,
          label: c.name,
          hint: t("容器 · {p0} · {p1}", { p0: host, p1: c.state }),
          icon: <ContainerIcon size={14} />,
          run: () =>
            go({
              id: `containerDetail:${hostId}:${c.id}`,
              title: t("容器: {p0}", { p0: c.name }),
              kind: 'containerDetail',
              hostId,
              containerId: c.id,
            }),
        });
      }
    }
    return out;
  }, [connections, statuses, containersByHost]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items.slice(0, MAX_ITEMS);
    return items
      .filter((it) => `${it.label} ${it.hint}`.toLowerCase().includes(q))
      .slice(0, MAX_ITEMS);
  }, [items, query]);

  useEffect(() => {
    setIndex(0);
  }, [query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setIndex(0);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    listRef.current?.children[index]?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  if (!open) return null;

  const runAt = (i: number) => {
    const it = filtered[i];
    if (!it) return;
    setOpen(false);
    it.run();
  };

  return (
    <div
      className="modal-backdrop"
      onClick={() => setOpen(false)}
      style={{ alignItems: 'flex-start', paddingTop: '12vh' }}
    >
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 560, padding: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 14px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <Search size={15} color="var(--text-muted)" />
          <input
            ref={inputRef}
            value={query}
            placeholder={t('搜索主机 / 容器 / 导航…（↑↓ 选择，Enter 打开）')}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setIndex((i) => Math.min(i + 1, filtered.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                runAt(index);
              } else if (e.key === 'Escape') {
                setOpen(false);
              }
            }}
            style={{ flex: 1, background: 'transparent', border: 'none', padding: 0, fontSize: 14 }}
          />
        </div>
        <div ref={listRef} style={{ maxHeight: 380, overflow: 'auto' }}>
          {filtered.length === 0 && (
            <div style={{ padding: 16, color: 'var(--text-muted)', fontSize: 12 }}>{t('没有匹配项')}</div>
          )}
          {filtered.map((it, i) => (
            <div
              key={it.id}
              onMouseEnter={() => setIndex(i)}
              onClick={() => runAt(i)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 14px',
                cursor: 'pointer',
                background: i === index ? 'var(--bg-selected)' : 'transparent',
                color: i === index ? 'var(--text-bright)' : 'var(--text)',
                fontSize: 12,
              }}
            >
              {it.icon}
              <span
                style={{
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {it.label}
              </span>
              <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{it.hint}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
