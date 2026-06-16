import type { RepoCommitEntry, V5SourceControlState, SourceControlRepo } from '@/types/state';
import { deriveRepoBaseUrl, getCommitLinkData } from './dag-timeline-helpers';

export type LocationKind = 'worktree' | 'in-place' | 'side-project';

/** FR-10: side-project (whole project) wins over in-place (per repo); default worktree. */
export function resolveLocationKind(
  projectType: 'standard' | 'side-project' | undefined,
  inPlace: boolean | undefined,
): LocationKind {
  if (projectType === 'side-project') return 'side-project';
  if (inPlace === true) return 'in-place';
  return 'worktree';
}

/** FR-9 / AD-5: convention-derived working-folder path; never read from stored state. */
export function resolveRepoFolderPath(args: {
  locationKind: LocationKind;
  projectName: string;
  repoName: string;
  registryPath: string | null;
}): string {
  const { locationKind, projectName, repoName, registryPath } = args;
  if (locationKind === 'side-project') return `~/.radorc/side-projects/${projectName}/`;
  if (locationKind === 'in-place') return registryPath ?? `~/.radorc/worktrees/${projectName}/${repoName}/`;
  return `~/.radorc/worktrees/${projectName}/${repoName}/`;
}

export const LOCATION_KIND_LABEL: Record<LocationKind, string> = {
  worktree: 'Worktree',
  'in-place': 'In-place · main clone',
  'side-project': 'Local · side-project',
};

/** AD-3: per-repo commit-link model; base URL derives from this repo's own compare_url. */
export interface CommitChipModel {
  repoName: string;
  href: string | null;
  shortHash: string | null;
  linkable: boolean;
}

/**
 * First non-empty commit hash across a multi-repo set. Drives the timeline
 * `commit` row's visibility: indexing `repos[0]` alone would hide the row when
 * the first repo hasn't committed but a later one has.
 */
export function firstCommitHash(repos: RepoCommitEntry[] | undefined): string | null {
  return repos?.find((r) => r.commit_hash != null && r.commit_hash !== '')?.commit_hash ?? null;
}

export function buildCommitChip(repo: RepoCommitEntry, compareUrl: string | null): CommitChipModel {
  const baseUrl = deriveRepoBaseUrl(compareUrl);
  const link = getCommitLinkData(repo.commit_hash, baseUrl);
  return {
    repoName: repo.name,
    href: link?.href ?? null,
    shortHash: link?.label ?? null,
    linkable: link?.href != null,
  };
}

/** FR-3: empty repos[] is treated identically to absent source_control. */
export function hasSourceControlRepos(sc: { repos?: { name: string }[] | undefined } | null): boolean {
  return !!sc && Array.isArray(sc.repos) && sc.repos.length > 0;
}

export function selectSourceControlRepos(sc: V5SourceControlState | null): SourceControlRepo[] {
  return sc?.repos ?? [];
}
