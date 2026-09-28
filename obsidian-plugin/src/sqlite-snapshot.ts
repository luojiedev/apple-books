import { open, stat } from "node:fs/promises";
import { debug } from "./models";

const MAX_BYTES = 128 * 1024 * 1024;
const BUSY = "Apple Books 数据库正在变化，请等待同步结束后重试；持续出现时请退出 Apple Books。";

function missing(error: unknown): boolean { return (error as NodeJS.ErrnoException).code === "ENOENT"; }

export async function databaseSignature(path: string): Promise<string> {
  const parts = await Promise.all([path, `${path}-wal`, `${path}-shm`, `${path}-journal`].map(async file => {
    try {
      const info = await stat(file, { bigint: true });
      if (!info.isFile()) throw new Error("数据库路径必须是文件。");
      return `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
    } catch (error) { if (file !== path && missing(error)) return "absent"; throw error; }
  }));
  return parts.join("|");
}

async function readLimited(path: string, optional = false): Promise<Buffer> {
  try {
    const file = await open(path, "r");
    try {
      const size = (await file.stat()).size;
      if (size > MAX_BYTES) throw new Error("单个数据库或 WAL 超过 128 MB，暂不支持读取。");
      const data = Buffer.alloc(size);
      let offset = 0;
      while (offset < size) {
        const { bytesRead } = await file.read(data, offset, size - offset, offset);
        if (!bytesRead) throw new Error(BUSY);
        offset += bytesRead;
      }
      return data;
    } finally { await file.close(); }
  } catch (error) { if (optional && missing(error)) return Buffer.alloc(0); throw error; }
}

// File metadata alone is insufficient for shm: SQLite updates it through mmap.
// Read both images twice, bracket them with metadata, and reject active checkpoints.
export async function readSnapshot(path: string): Promise<Buffer> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = await databaseSignature(path);
    const read = async () => Promise.all([readLimited(path), readLimited(`${path}-wal`, true), readLimited(`${path}-shm`, true), readLimited(`${path}-journal`, true)]);
    const first = await read();
    const second = await read();
    if (before !== await databaseSignature(path) || first.some((data, i) => !data.equals(second[i]!))) {
      debug("database changed during snapshot", { attempt: attempt + 1 });
      await new Promise(resolve => setTimeout(resolve, 50));
      continue;
    }
    const [database, wal, shm, journal] = second as [Buffer, Buffer, Buffer, Buffer];
    if (journal.some(byte => byte !== 0)) throw new Error("数据库存在回滚日志，请先用 Apple Books 完成恢复后重试。");
    return mergeCommittedWal(database, wal, shm);
  }
  throw new Error(BUSY);
}

type Checksum = [number, number];
function checksum(data: Buffer, littleEndian: boolean, initial: Checksum = [0, 0]): Checksum {
  let [a, b] = initial;
  for (let i = 0; i < data.length; i += 8) {
    a = (a + (littleEndian ? data.readUInt32LE(i) : data.readUInt32BE(i)) + b) >>> 0;
    b = (b + (littleEndian ? data.readUInt32LE(i + 4) : data.readUInt32BE(i + 4)) + a) >>> 0;
  }
  return [a, b];
}

// SQLite format: https://www.sqlite.org/fileformat.html#write_ahead_log_format
// Only committed frames enter the in-memory image. Never checkpoint the source.
export function mergeCommittedWal(database: Buffer, wal: Buffer, shm: Buffer = Buffer.alloc(0)): Buffer {
  if (database.length < 100 || database.toString("ascii", 0, 16) !== "SQLite format 3\0") throw new Error("无效的 SQLite 数据库。");
  const pageSize = database.readUInt16BE(16) === 1 ? 65536 : database.readUInt16BE(16);
  if (pageSize < 512 || pageSize > 65536 || (pageSize & (pageSize - 1)) !== 0 || database.length % pageSize !== 0) throw new Error("无效的 SQLite 页面大小。");
  let result = Buffer.from(database);
  if (wal.length) {
    if (wal.length < 32) throw new Error(BUSY);
    const magic = wal.readUInt32BE(0);
    if ((magic !== 0x377f0682 && magic !== 0x377f0683) || wal.readUInt32BE(4) !== 3007000 || wal.readUInt32BE(8) !== pageSize) throw new Error("不支持或损坏的 SQLite WAL。");
    const littleEndian = magic === 0x377f0682;
    let sum = checksum(wal.subarray(0, 24), littleEndian);
    if (sum[0] !== wal.readUInt32BE(24) || sum[1] !== wal.readUInt32BE(28)) throw new Error("WAL 头校验失败。");
    let publishedFrames: number | undefined;
    if (shm.length) {
      if (shm.length < 136 || !shm.subarray(0, 48).equals(shm.subarray(48, 96)) || shm[12] !== 1) throw new Error(BUSY);
      const headerSum = checksum(shm.subarray(0, 40), true);
      if (headerSum[0] !== shm.readUInt32LE(40) || headerSum[1] !== shm.readUInt32LE(44)) throw new Error(BUSY);
      if (!shm.subarray(32, 40).equals(wal.subarray(16, 24)) || shm.readUInt32LE(128) > shm.readUInt32LE(96)) throw new Error(BUSY);
      publishedFrames = shm.readUInt32LE(16);
    }
    const frames: { page: number; offset: number }[] = [];
    let committedFrames = 0;
    let committedPages = 0;
    for (let offset = 32; offset + 24 + pageSize <= wal.length; offset += 24 + pageSize) {
      if (publishedFrames !== undefined && frames.length >= publishedFrames) break;
      if (!wal.subarray(offset + 8, offset + 16).equals(wal.subarray(16, 24))) break; // stale frames after WAL reset
      sum = checksum(wal.subarray(offset, offset + 8), littleEndian, sum);
      sum = checksum(wal.subarray(offset + 24, offset + 24 + pageSize), littleEndian, sum);
      if (sum[0] !== wal.readUInt32BE(offset + 16) || sum[1] !== wal.readUInt32BE(offset + 20)) throw new Error("WAL 页面校验失败，请等待 Apple Books 同步完成后重试。");
      const page = wal.readUInt32BE(offset);
      const pages = wal.readUInt32BE(offset + 4);
      if (!page || page * pageSize > MAX_BYTES || pages * pageSize > MAX_BYTES) throw new Error("WAL 页面超出读取上限。");
      frames.push({ page, offset: offset + 24 });
      if (pages) { committedFrames = frames.length; committedPages = pages; }
    }
    if (publishedFrames !== undefined && committedFrames !== publishedFrames) throw new Error(BUSY);
    if (publishedFrames && (sum[0] !== shm.readUInt32LE(24) || sum[1] !== shm.readUInt32LE(28) || committedPages !== shm.readUInt32LE(20))) throw new Error(BUSY);
    if (committedFrames) {
      result = Buffer.alloc(committedPages * pageSize);
      database.copy(result);
      for (const frame of frames.slice(0, committedFrames)) {
        if (frame.page <= committedPages) wal.copy(result, (frame.page - 1) * pageSize, frame.offset, frame.offset + pageSize);
      }
    }
  }
  // sql.js has no shared-memory VFS. This private, fully replayed image uses
  // rollback format; the source bytes and WAL are never modified.
  result[18] = 1;
  result[19] = 1;
  return result;
}
