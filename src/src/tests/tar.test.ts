import { describe, it, expect } from 'vitest';
import { packSingleFile, extractFirstEntry } from '../../electron/docker/tar';

describe('tar packSingleFile / extractFirstEntry', () => {
  it('round-trips file name and content', () => {
    const content = Buffer.from('hello 容器文件\n'.repeat(50));
    const tar = packSingleFile('notes.txt', content);
    const out = extractFirstEntry(tar);
    expect(out.name).toBe('notes.txt');
    expect(out.data.equals(content)).toBe(true);
  });

  it('round-trips empty and binary content', () => {
    expect(extractFirstEntry(packSingleFile('empty', Buffer.alloc(0))).data.length).toBe(0);
    const bin = Buffer.from([0, 1, 2, 0xff, 0xfe, 3, 4, 5]);
    expect(extractFirstEntry(packSingleFile('b.bin', bin)).data.equals(bin)).toBe(true);
  });

  it('produces block-aligned archives with an end marker', () => {
    const tar = packSingleFile('f', Buffer.alloc(1000));
    expect(tar.length % 512).toBe(0);
    // header(512) + content(1024) + two zero blocks(1024)
    expect(tar.length).toBe(512 + 1024 + 1024);
    expect(tar.subarray(tar.length - 1024).every((b) => b === 0)).toBe(true);
  });

  it('writes a valid ustar magic and checksum', () => {
    const tar = packSingleFile('f', Buffer.from('x'));
    const header = tar.subarray(0, 512);
    expect(header.subarray(257, 262).toString()).toBe('ustar');
    const stored = parseInt(header.subarray(148, 156).toString('ascii').replace(/[\0 ]/g, ''), 8);
    const sum = header.reduce((s, b, i) => s + (i >= 148 && i < 156 ? 0x20 : b), 0);
    expect(sum).toBe(stored);
  });

  it('rejects names beyond the ustar limit', () => {
    expect(() => packSingleFile('a'.repeat(100), Buffer.alloc(1))).toThrow();
  });

  it('truncates rather than lies on short input', () => {
    const tar = packSingleFile('f', Buffer.alloc(100));
    expect(() => extractFirstEntry(tar.subarray(0, 300))).toThrow();
  });
});
