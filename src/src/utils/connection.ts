/** Shared helpers for host connection errors in the renderer. */

let inflight = new Map<string, Promise<unknown>>();

/**
 * Deduplicate concurrent connect() calls for the same host.
 * Multiple tabs / HostGuard instances may request connect at once.
 */
export function connectOnce(hostId: string): Promise<import('../types/docker').ConnectionStatus> {
  const existing = inflight.get(hostId);
  if (existing) return existing as Promise<import('../types/docker').ConnectionStatus>;

  const p = window.dockerApi.connect(hostId).finally(() => {
    inflight.delete(hostId);
  });
  inflight.set(hostId, p);
  return p;
}

export function isNotConnectedError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  // i18n:allow-zh — matches main-process error text, not user-visible
  return /Not connected|not connected|未连接/i.test(msg);
}

/**
 * Report an error to the toast UI, but swallow expected "not connected"
 * noise (HostGuard / connection status already surfaces that state).
 */
export function reportError(
  e: unknown,
  toast: (msg: string, type?: 'info' | 'success' | 'error') => void
) {
  if (isNotConnectedError(e)) return;
  toast(e instanceof Error ? e.message : String(e), 'error');
}
