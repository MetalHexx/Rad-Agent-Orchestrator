import { deriveArtifacts, type Artifact } from '@/lib/artifact-model';

export interface ArtifactSnapshot {
  /** False when the fetch failed (non-OK status or thrown). Distinguishes a failed
   *  fetch from a genuinely empty project so callers never store a failure as the
   *  diff baseline (which would make the next snapshot pulse every file as `added`). */
  ok: boolean;
  files: string[];
  artifacts: Artifact[];
  mtimes: Record<string, number>;
  /** Requirements-doc frontmatter status (trimmed+lower-cased or null) from
   *  the `/files` response — carried here so it rides the same live refresh
   *  as everything else instead of a separate one-time fetch. */
  requirementsStatus: string | null;
}

export interface SnapshotChange {
  fileName: string;
  kind: 'added' | 'changed' | 'removed';
}

// Fresh per call so a caller that stores/mutates the arrays can't corrupt a
// shared instance — matches the original non-OK return.
const emptySnapshot = (): ArtifactSnapshot => ({ ok: false, files: [], artifacts: [], mtimes: {}, requirementsStatus: null });

export async function fetchArtifactSnapshot(
  projectName: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ArtifactSnapshot> {
  try {
    const res = await fetchImpl(`/api/projects/${encodeURIComponent(projectName)}/files`);
    if (!res.ok) return emptySnapshot();
    const data = (await res.json()) as { files: string[]; mtimes?: Record<string, number>; requirementsStatus?: string | null };
    const files = data.files ?? [];
    const mtimes = data.mtimes ?? {};
    const artifacts = deriveArtifacts(projectName, files);
    return { ok: true, files, artifacts, mtimes, requirementsStatus: data.requirementsStatus ?? null };
  } catch {
    // A rejected fetch (offline/DNS/CORS) or a thrown res.json() resolves to the
    // same empty snapshot as a non-OK response, so callers that `void` this
    // (e.g. refreshSnapshot) never surface an unhandled rejection.
    return emptySnapshot();
  }
}

/** Self-heal: a reconnect snapshot drops unseen entries for files that are gone. */
export function reconcileUnseen(unseen: Set<string>, currentFiles: string[]): Set<string> {
  const present = new Set(currentFiles);
  const next = new Set<string>();
  for (const f of unseen) if (present.has(f)) next.add(f);
  return next;
}

/**
 * Derive per-file changes between two snapshots. A live `artifact_change`
 * notification carries no filename, so the provider compares the freshly pulled
 * snapshot against the previous one: a new file is `added`, a file whose mtime
 * advanced is `changed`, and a file that disappeared is `removed`. An unchanged
 * file emits nothing.
 */
export function diffSnapshots(
  prevFiles: string[],
  prevMtimes: Record<string, number>,
  nextFiles: string[],
  nextMtimes: Record<string, number>,
): SnapshotChange[] {
  const prevSet = new Set(prevFiles);
  const nextSet = new Set(nextFiles);
  const changes: SnapshotChange[] = [];
  for (const f of nextFiles) {
    if (!prevSet.has(f)) changes.push({ fileName: f, kind: 'added' });
    else if ((nextMtimes[f] ?? 0) > (prevMtimes[f] ?? 0)) changes.push({ fileName: f, kind: 'changed' });
  }
  for (const f of prevFiles) {
    if (!nextSet.has(f)) changes.push({ fileName: f, kind: 'removed' });
  }
  return changes;
}
