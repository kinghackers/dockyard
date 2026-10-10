import { safeStorage } from 'electron';

/**
 * At-rest protection for connection secrets (SSH password / passphrase,
 * inline TLS key & client cert) using the OS keychain via Electron safeStorage.
 *
 * On-disk format: `enc:v1:<base64>` so plaintext (legacy) values are detectable.
 */

const ENC_PREFIX = 'enc:v1:';

export function isEncrypted(value: string | undefined): boolean {
  return !!value && value.startsWith(ENC_PREFIX);
}

export function encryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

/** Encrypt a secret for disk. Returns plaintext unchanged when crypto is unavailable. */
export function encryptSecret(plain: string | undefined): string | undefined {
  if (!plain) return plain;
  if (isEncrypted(plain)) return plain;
  if (!encryptionAvailable()) return plain;
  try {
    return ENC_PREFIX + safeStorage.encryptString(plain).toString('base64');
  } catch {
    return plain;
  }
}

/** Decrypt a secret loaded from disk. Legacy plaintext passes through. */
export function decryptSecret(value: string | undefined): string | undefined {
  if (!value) return value;
  if (!isEncrypted(value)) return value;
  if (!encryptionAvailable()) return undefined;
  try {
    return safeStorage.decryptString(Buffer.from(value.slice(ENC_PREFIX.length), 'base64'));
  } catch {
    return undefined;
  }
}

/** True when the record still holds one or more secrets in plaintext. */
export function hasPlaintextSecret(fields: (string | undefined)[]): boolean {
  return fields.some((v) => !!v && !isEncrypted(v));
}
