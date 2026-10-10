import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// vitest runs without globals, so @testing-library/react cannot register its
// auto-cleanup — do it explicitly or every renderHook stays mounted and leaks
// document listeners (e.g. usePolling's visibilitychange) across tests
afterEach(() => {
  cleanup();
});
