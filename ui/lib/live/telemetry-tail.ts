import { openSync, readSync, closeSync, statSync } from 'node:fs';

export interface TailResult { lines: string[]; offset: number; }

// Reads byteOffset→EOF, returning complete lines only and advancing past the last newline.
// Only the [byteOffset, size) slice is read (positional read), not the whole file — the
// byte-offset cursor is the source of truth and partitions grow append-only (AD-6), so
// re-reading from the top on every append would scale O(filesize) per event (NFR-1).
export function tailCompleteLines(file: string, byteOffset: number): TailResult {
  const size = statSync(file).size;
  if (byteOffset >= size) return { lines: [], offset: byteOffset };
  const length = size - byteOffset;
  const buf = Buffer.allocUnsafe(length);
  const fd = openSync(file, 'r');
  let bytesRead = 0;
  try {
    bytesRead = readSync(fd, buf, 0, length, byteOffset);
  } finally {
    closeSync(fd);
  }
  const slice = buf.subarray(0, bytesRead).toString('utf8');
  const lastNl = slice.lastIndexOf('\n');
  if (lastNl < 0) return { lines: [], offset: byteOffset };
  const consumed = Buffer.byteLength(slice.slice(0, lastNl + 1), 'utf8');
  const lines = slice.slice(0, lastNl).split('\n').filter((l) => l.trim().length > 0);
  return { lines, offset: byteOffset + consumed };
}
