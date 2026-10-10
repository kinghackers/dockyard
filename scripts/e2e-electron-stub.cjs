/**
 * Minimal electron stub for the E2E smoke test: connectionManager bundles in
 * the renderer-facing 'electron' module only for safeStorage.
 */
module.exports = {
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s) => Buffer.from(s, 'utf8'),
    decryptString: (b) => b.toString('utf8'),
  },
};
