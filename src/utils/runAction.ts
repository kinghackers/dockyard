import { reportError } from './connection';

type ToastFn = (msg: string, type?: 'info' | 'success' | 'error', durationMs?: number) => void;

export interface RunActionOptions {
  /** Shown immediately so the click is acknowledged. */
  pending: string;
  /** Shown after the call resolves. */
  ok: string;
  /** Optional subject prefix, e.g. container name. */
  name?: string;
}

/**
 * Run a docker action with immediate + completion feedback.
 * Click → "正在停止 webdav…" → "webdav: 已停止" / error toast.
 */
export async function runAction(
  toast: ToastFn,
  opts: RunActionOptions,
  fn: () => Promise<unknown>
): Promise<void> {
  const prefix = opts.name ? `${opts.name}: ` : '';
  toast(`${prefix}${opts.pending}`, 'info', 1800);
  try {
    await fn();
    toast(`${prefix}${opts.ok}`, 'success');
  } catch (e) {
    reportError(e, toast);
  }
}
