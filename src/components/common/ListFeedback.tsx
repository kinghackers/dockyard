import { XCircle } from 'lucide-react';
import { t, useT } from '../../i18n';

/** Inline error banner with retry for list pages (replaces the misleading "暂无 X" empty state on failure). */
export function ListError({ error, onRetry }: { error: string; onRetry: () => void }) {
  const t = useT();
  return (
    <div className="list-error">
      <XCircle size={14} />
      <span style={{ flex: 1, minWidth: 0 }}>{t('加载失败：')}{error}</span>
      <button className="btn" onClick={onRetry} style={{ height: 24 }}>
        {t('重试')}
      </button>
    </div>
  );
}

/** First-load placeholder so an initially-empty table is not mistaken for "no data yet" while fetching. */
export function ListLoading({ label }: { label: string }) {
  return (
    <div className="empty-state">
      <span className="spinner" style={{ width: 22, height: 22, borderWidth: 3 }} />
      <p>{label}</p>
    </div>
  );
}
