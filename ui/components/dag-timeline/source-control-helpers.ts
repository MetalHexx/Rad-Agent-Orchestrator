import type { RepoCommitEntry, V5SourceControlState, SourceControlRepo } from '@/types/state';
import type { ProjectKind } from '@/types/components';
import { deriveRepoBaseUrl, getCommitLinkData } from './dag-timeline-helpers';

export type LocationKind = 'worktree' | 'in-place' | 'side-project';

/** FR-10: side-project (whole project) wins over in-place (per repo); default worktree. */
export function resolveLocationKind(
  projectType: ProjectKind | undefined,
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

/** A repo carrying a live pull request, ready for display. */
export interface PrLink {
  repoName: string;
  url: string;
}

/**
 * Every repo carrying a non-empty `pr_url`, in `repos[]` order; `[]` when
 * none. Repo-aware replacement for the single `repos[0].pr_url` pin that
 * previously dropped every PR but the first — and hid all of them once the
 * first repo's PR closed even while others stayed open.
 */
export function selectPrLinks(sc: V5SourceControlState | null | undefined): PrLink[] {
  if (!sc) return [];
  return sc.repos
    .filter((repo): repo is SourceControlRepo & { pr_url: string } => !!repo.pr_url)
    .map((repo) => ({ repoName: repo.name, url: repo.pr_url }));
}
