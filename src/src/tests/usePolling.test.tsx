// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePolling } from '../hooks/usePolling';

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true });
});

afterEach(() => {
  vi.useRealTimers();
});

async function flush() {
  // let pending microtasks (awaited loads) settle
  await vi.advanceTimersByTimeAsync(0);
}

describe('usePolling', () => {
  it('loads immediately on first mount', async () => {
    const onLoad = vi.fn(async () => {});
    renderHook(() => usePolling({ active: true, intervalMs: 10_000, onLoad }));
    await act(() => flush());
    expect(onLoad).toHaveBeenCalledTimes(1);
  });

  it('loads immediately even with catchUp: false (dashboard freeze mode)', async () => {
    const onLoad = vi.fn(async () => {});
    renderHook(() => usePolling({ active: true, intervalMs: 10_000, onLoad, catchUp: false }));
    await act(() => flush());
    expect(onLoad).toHaveBeenCalledTimes(1);
  });

  it('loads on cadence while active', async () => {
    const onLoad = vi.fn(async () => {});
    renderHook(() => usePolling({ active: true, intervalMs: 10_000, onLoad }));
    await act(() => flush());
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(onLoad).toHaveBeenCalledTimes(3);
  });

  it('interval <= 0 disables polling but still runs the initial load', async () => {
    const onLoad = vi.fn(async () => {});
    renderHook(() => usePolling({ active: true, intervalMs: 0, onLoad }));
    await act(() => flush());
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(onLoad).toHaveBeenCalledTimes(1);
  });

  it('does not poll while inactive, and catchUp:false does not reload on reactivation', async () => {
    const onLoad = vi.fn(async () => {});
    const h = renderHook(({ active }) => usePolling({ active, intervalMs: 10_000, onLoad, catchUp: false }), {
      initialProps: { active: true },
    });
    await act(() => flush());
    expect(onLoad).toHaveBeenCalledTimes(1);

    // hide the surface: no further loads
    h.rerender({ active: false });
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(onLoad).toHaveBeenCalledTimes(1);

    // reactivate: frozen surfaces resume the cadence without a catch-up load
    h.rerender({ active: true });
    await act(() => flush());
    expect(onLoad).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(onLoad).toHaveBeenCalledTimes(2);
  });

  it('default catchUp reloads immediately on reactivation when stale', async () => {
    const onLoad = vi.fn(async () => {});
    const h = renderHook(({ active }) => usePolling({ active, intervalMs: 10_000, onLoad }), {
      initialProps: { active: true },
    });
    await act(() => flush());
    expect(onLoad).toHaveBeenCalledTimes(1);

    h.rerender({ active: false });
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    h.rerender({ active: true });
    await act(() => flush());
    // stale after a minute away → catch-up fires right away
    expect(onLoad).toHaveBeenCalledTimes(2);
  });

  it('skips loads while the document is hidden, then catches up when visible', async () => {
    const onLoad = vi.fn(async () => {});
    renderHook(() => usePolling({ active: true, intervalMs: 10_000, onLoad }));
    await act(() => flush());
    expect(onLoad).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, 'hidden', { value: true, writable: true, configurable: true });
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    // ticks ran but the load itself was skipped while hidden
    expect(onLoad).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true });
    await act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await act(() => flush());
    expect(onLoad).toHaveBeenCalledTimes(2);
  });

  it('reloads when reloadKey changes', async () => {
    const onLoad = vi.fn(async () => {});
    const h = renderHook(({ key }) => usePolling({ active: true, reloadKey: key, intervalMs: 10_000, onLoad }), {
      initialProps: { key: 'host-a' },
    });
    await act(() => flush());
    expect(onLoad).toHaveBeenCalledTimes(1);

    h.rerender({ key: 'host-b' });
    await act(() => flush());
    expect(onLoad).toHaveBeenCalledTimes(2);
  });
});
