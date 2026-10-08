import * as fs from 'fs';
import * as path from 'path';

export interface JsonStoreReadResult<T> {
  /** parsed value, or null when the file is absent / unreadable / not JSON */
  value: T | null;
  /**
   * Set when the file exists but could not be parsed: it has been moved to
   * this backup path so the next save cannot overwrite the user's data.
   */
  corruptedBackup?: string;
}

/**
 * Read a JSON file written by writeJsonStore. A corrupt file is renamed to
 * `<file>.corrupt-<timestamp>.bak` (preserving it for manual recovery) and
 * reported through `corruptedBackup` instead of silently reading as empty —
 * otherwise the next save would permanently wipe the stored data.
 */
export function readJsonStore<T>(file: string): JsonStoreReadResult<T> {
  if (!fs.existsSync(file)) return { value: null };
  try {
    return { value: JSON.parse(fs.readFileSync(file, 'utf8')) as T };
  } catch (err) {
    const backup = `${file}.corrupt-${Date.now().toString(36)}.bak`;
    try {
      fs.renameSync(file, backup);
    } catch {
      // could not move it aside — leave the file in place; reads keep failing
      // loudly instead of returning empty and inviting a data-wiping save
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`配置文件损坏且无法备份 (${file}): ${msg}`);
    }
    console.error(`[configStore] ${file} 损坏，已备份到 ${backup}`);
    return { value: null, corruptedBackup: backup };
  }
}

/**
 * Write JSON atomically: serialize to a sibling temp file first, then rename
 * over the target, so a crash mid-write can never leave a truncated file.
 */
export function writeJsonStore(file: string, data: unknown): void {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.tmp-${process.pid.toString(36)}`);
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  try {
    fs.renameSync(tmp, file);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw err;
  }
}
