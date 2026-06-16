import type { BindState } from '@/components/repo-registry/types';

export interface RepoBindInfo { state: BindState; path: string | null }

/** AD-2: registry slug === source-control repo name; join into a by-name lookup. */
export function buildBindLookup(
  registryRepos: ReadonlyArray<{ slug: string; bind: { state: BindState; path: string | null } }>,
): Record<string, RepoBindInfo> {
  const out: Record<string, RepoBindInfo> = {};
  for (const r of registryRepos) out[r.slug] = { state: r.bind.state, path: r.bind.path };
  return out;
}

