/**
 * Minimal ustar-tar helpers for container file transfer (docker cp-style).
 * Only what we need: pack exactly one regular file, and extract the first
 * entry — that's the shape `getArchive`/`putArchive` use for single files.
 */

const BLOCK = 512;

function octal(value: number, length: number): string {
  return value.toString(8).padStart(length, '0');
}

/** Serialize a header field: content + NUL padding to the field width. */
function field(content: string, width: number): Buffer {
  const b = Buffer.alloc(width, 0);
  b.write(content.slice(0, width - 1), 0, 'utf8');
  return b;
}

/** Pack a single regular file into a ustar archive buffer. */
export function packSingleFile(name: string, content: Buffer): Buffer {
  if (name.length > 99) throw new Error('文件名过长（ustar 限制 99 字节）');
  const header = Buffer.alloc(BLOCK, 0);
  field(name, 100).copy(header, 0);
  field(octal(0o644, 7) + '\0', 8).copy(header, 100); // mode
  field(octal(0, 7) + '\0', 8).copy(header, 108); // uid
  field(octal(0, 7) + '\0', 8).copy(header, 116); // gid
  field(octal(content.length, 11) + ' ', 12).copy(header, 124); // size
  field(octal(Math.floor(Date.now() / 1000), 11) + ' ', 12).copy(header, 136); // mtime
  header.fill(' ', 148, 156); // checksum placeholder spaces during sum
  field('0', 1).copy(header, 156); // typeflag: regular file
  field('ustar\0', 6).copy(header, 257); // magic
  field('00', 2).copy(header, 263); // version

  let sum = 0;
  for (const byte of header) sum += byte;
  // checksum field: 6 octal digits + NUL + space (written raw — field() would
  // reserve the last byte for a NUL and drop the required trailing space)
  header.write(octal(sum, 6), 148, 'ascii');
  header[154] = 0;
  header[155] = 0x20;

  const padded = Buffer.alloc(Math.ceil(content.length / BLOCK) * BLOCK, 0);
  content.copy(padded, 0);
  return Buffer.concat([header, padded, Buffer.alloc(BLOCK * 2, 0)]);
}

/** Extract the first entry of a ustar archive (name + raw content). */
export function extractFirstEntry(archive: Buffer): { name: string; data: Buffer } {
  if (archive.length < BLOCK) throw new Error('tar 数据不完整');
  const header = archive.subarray(0, BLOCK);

  const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
  const sizeStr = header.subarray(124, 136).toString('utf8').replace(/[\0 ]/g, '');
  const type = String.fromCharCode(header[156] || 0x30);
  const size = parseInt(sizeStr, 8); // tar sizes are octal
  if (!Number.isFinite(size) || size < 0) throw new Error('tar 大小字段无效');
  if (type !== '0' && type !== '\0') {
    throw new Error(`tar 首个条目不是普通文件（${name || '(空)'}）`);
  }

  const data = Buffer.from(archive.subarray(BLOCK, BLOCK + size));
  if (data.length < size) throw new Error('tar 数据被截断');
  return {
    name: name.replace(/^.*\//, '') || name, // docker getArchive nests under the file name
    data,
  };
}

/** Read a full stream into one buffer. */
export function readStreamToEnd(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (c: Buffer) => chunks.push(c));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}
