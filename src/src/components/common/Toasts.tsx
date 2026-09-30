import { X } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';

export function Toasts() {
  const { toasts, dismissToast } = useAppStore();
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.type}`}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>{t.message}</div>
            <button
              className="btn ghost icon-btn"
              style={{ width: 20, height: 20 }}
              onClick={() => dismissToast(t.id)}
            >
              <X size={12} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
