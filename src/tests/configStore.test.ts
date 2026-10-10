import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { readJsonStore, writeJsonStore } from '../../electron/docker/configStore';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dockyard-test-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('writeJsonStore', () => {
  it('round-trips data', () => {
    const file = path.join(dir, 'data.json');
    writeJsonStore(file, [{ id: 'a', name: '本机' }]);
    expect(readJsonStore(file)).toEqual({ value: [{ id: 'a', name: '本机' }] });
  });

  it('creates the parent directory when missing', () => {
    const file = path.join(dir, 'nested', 'deep', 'data.json');
    writeJsonStore(file, { ok: true });
    expect(readJsonStore<{ ok: boolean }>(file).value).toEqual({ ok: true });
  });

  it('replaces an existing file completely', () => {
    const file = path.join(dir, 'data.json');
    writeJsonStore(file, { version: 1, extra: 'x'.repeat(100) });
    writeJsonStore(file, { version: 2 });
    expect(readJsonStore(file).value).toEqual({ version: 2 });
  });

  it('leaves no temp files behind', () => {
    const file = path.join(dir, 'data.json');
    writeJsonStore(file, { a: 1 });
    const leftovers = fs.readdirSync(dir).filter((f) => f.includes('.tmp-'));
    expect(leftovers).toEqual([]);
  });
});

describe('readJsonStore', () => {
  it('returns null for a missing file without creating anything', () => {
    const file = path.join(dir, 'absent.json');
    expect(readJsonStore(file)).toEqual({ value: null });
    expect(fs.existsSync(file)).toBe(false);
  });

  it('backs up a corrupt file and reports it instead of reading empty', () => {
    const file = path.join(dir, 'data.json');
    fs.writeFileSync(file, '{ not valid json !!', 'utf8');

    const res = readJsonStore(file);
    expect(res.value).toBeNull();
    expect(res.corruptedBackup).toBeTruthy();
    expect(fs.existsSync(res.corruptedBackup!)).toBe(true);
    expect(fs.readFileSync(res.corruptedBackup!, 'utf8')).toBe('{ not valid json !!');
    // the original path is cleared so the next save starts fresh
    expect(fs.existsSync(file)).toBe(false);
  });

  it('does not lose older backups when corruption repeats', () => {
    const file = path.join(dir, 'data.json');
    const backups: string[] = [];
    for (let i = 0; i < 2; i++) {
      fs.writeFileSync(file, 'garbage', 'utf8');
      const res = readJsonStore(file);
      backups.push(res.corruptedBackup!);
    }
    expect(backups[0]).not.toBe(backups[1]);
    expect(backups.every((b) => fs.existsSync(b))).toBe(true);
  });
});
