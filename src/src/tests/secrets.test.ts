import { describe, it, expect, vi } from 'vitest';

/**
 * secrets.ts talks to Electron's safeStorage; mock the module so the
 * on-disk format contract can be tested outside Electron.
 */
vi.mock('electron', () => {
  const state = { available: true };
  return {
    safeStorage: {
      isEncryptionAvailable: () => state.available,
      encryptString: (s: string) => Buffer.from(`enc(${s})`),
      decryptString: (b: Buffer) => {
        const text = b.toString();
        if (!text.startsWith('enc(') || !text.endsWith(')')) throw new Error('bad blob');
        return text.slice(4, -1);
      },
      __state: state,
    },
  };
});

import {
  isEncrypted,
  encryptSecret,
  decryptSecret,
  hasPlaintextSecret,
} from '../../electron/docker/secrets';
import { safeStorage } from 'electron';

const state = (safeStorage as unknown as { __state: { available: boolean } }).__state;

describe('secrets on-disk format', () => {
  it('round-trips a secret through encrypt/decrypt', () => {
    const stored = encryptSecret('s3cret!');
    expect(stored).toMatch(/^enc:v1:/);
    expect(isEncrypted(stored)).toBe(true);
    expect(decryptSecret(stored)).toBe('s3cret!');
  });

  it('passes undefined / empty through untouched', () => {
    expect(encryptSecret(undefined)).toBeUndefined();
    expect(decryptSecret(undefined)).toBeUndefined();
    expect(isEncrypted(undefined)).toBe(false);
  });

  it('does not double-encrypt an already-encrypted value', () => {
    const once = encryptSecret('pw');
    expect(encryptSecret(once)).toBe(once);
  });

  it('treats legacy plaintext as plaintext (decrypt passes through)', () => {
    expect(isEncrypted('my-old-password')).toBe(false);
    expect(decryptSecret('my-old-password')).toBe('my-old-password');
  });

  it('falls back to plaintext when encryption is unavailable', () => {
    state.available = false;
    expect(encryptSecret('pw')).toBe('pw');
    // encrypted blobs cannot be decrypted without safeStorage → undefined,
    // so data is not silently mis-decrypted
    expect(decryptSecret('enc:v1:AAAA')).toBeUndefined();
    state.available = true;
  });

  it('flags records that still hold plaintext secrets', () => {
    expect(hasPlaintextSecret([undefined, 'plain'])).toBe(true);
    expect(hasPlaintextSecret([undefined, encryptSecret('x')])).toBe(false);
    expect(hasPlaintextSecret([undefined])).toBe(false);
  });
});
