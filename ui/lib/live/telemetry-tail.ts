import { readFileSync, statSync } from 'node:fs';

export interface TailResult { lines: string[]; offset: number; }

// Reads byteOffset→EOF, returning complete lines only and advancing past the last newline.
export function tailCompleteLines(file: string, byteOffset: number): TailResult {
  const size = statSync(file).size;
  if (byteOffset >= size) return { lines: [], offset: byteOffset };
  const slice = readFileSync(file).subarray(byteOffset, size).toString('utf8');
  const lastNl = slice.lastIndexOf('\n');
  if (lastNl < 0) return { lines: [], offset: byteOffset };
  const consumed = Buffer.byteLength(slice.slice(0, lastNl + 1), 'utf8');
  const lines = slice.slice(0, lastNl).split('\n').filter((l) => l.trim().length > 0);
  return { lines, offset: byteOffset + consumed };
}
