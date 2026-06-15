"use client";
import { Github } from 'lucide-react';
import { buildCommitChip } from './source-control-helpers';
import type { RepoCommitEntry } from '@/types/state';

export interface CommitChipsProps {
  repos: RepoCommitEntry[];
  compareUrlByRepo: Record<string, string | null>;
  singleRepo: boolean;
}

export function CommitChips({ repos, compareUrlByRepo, singleRepo }: CommitChipsProps) {
  if (!repos || repos.length === 0) return null;
  return (
    <span className="inline-flex items-center gap-3">
      {repos.map((repo) => {
        const chip = buildCommitChip(repo, compareUrlByRepo[repo.name] ?? null);
        const showName = !singleRepo;
        if (chip.linkable && chip.shortHash) {
          return (
            <a key={repo.name} href={chip.href!} target="_blank" rel="noopener noreferrer" tabIndex={-1}
              title={repo.commit_hash ?? undefined}
              aria-label={`View ${repo.name} commit ${chip.shortHash} on GitHub`}
              className="inline-flex items-center gap-1 rounded-sm text-xs hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Github className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              {showName && <span className="text-muted-foreground">{repo.name}:</span>}
              <span className="font-medium text-primary">{chip.shortHash}</span>
            </a>
          );
        }
        // not landed / not linkable
        if (singleRepo) return null; // FR-12: single-repo + not linkable → suppress (a lone icon conveys nothing)
        return (
          <span key={repo.name} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
            aria-label={`${repo.name} — no commit yet`}>
            <Github className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{repo.name}</span>
          </span>
        );
      })}
    </span>
  );
}
