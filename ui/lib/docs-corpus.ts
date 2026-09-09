import path from 'node:path';
import { getDocsRoot } from '@/lib/path-resolver';

/** Whether `candidate` resolves to a path inside `root`, using the three-part
 *  `path.relative` idiom rather than a `startsWith` prefix check. */
export function isContainedIn(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** Matches a Windows drive-letter path (`C:/...` or `C:\...`) so it can be
 *  rejected on every host OS — `path.resolve` only recognizes it as absolute
 *  on win32, so on POSIX it would otherwise resolve as an ordinary relative
 *  segment nested inside the corpus root instead of being caught. */
const WINDOWS_DRIVE_LETTER = /^[A-Za-z]:[/\\]/;

/** Absolute path for a corpus-relative posix path, or null when it escapes the corpus root. */
export function resolveCorpusPath(relative: string): string | null {
  if (WINDOWS_DRIVE_LETTER.test(relative)) return null;
  const cleaned = relative.replace(/\\/g, '/').replace(/^\/+/, '');
  const abs = path.resolve(getDocsRoot(), cleaned);
  return isContainedIn(getDocsRoot(), abs) ? abs : null;
}
