"use client";
import { Github } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { buildCommitChip } from './source-control-helpers';
import type { RepoCommitEntry } from '@/types/state';

export interface CommitChipsProps {
  repos: RepoCommitEntry[];
  compareUrlByRepo: Record<string, string | null>;
  singleRepo: boolean;
  /**
   * Visual style. `'chip'` (default) renders borderless inline chips for the
   * dense dag-timeline rows. `'button'` renders each repo as an outline+icon
   * button matching the dag-widget card's other controls, so every affordance
   * in a card's controls row reads as the same button.
   */
  variant?: 'chip' | 'button';
  /**
   * In the `'button'` variant, the CSS custom property (e.g. `--tier-execution`)
   * tinting each leading git icon, matching the sibling doc buttons' tier tint.
   */
  iconCssVar?: string;
}

export function CommitChips({ repos, compareUrlByRepo, singleRepo, variant = 'chip', iconCssVar }: CommitChipsProps) {
  if (!repos || repos.length === 0) return null;

  if (variant === 'button') {
    const iconStyle = iconCssVar ? { color: `var(${iconCssVar})` } : undefined;
    const outlineClass = buttonVariants({ variant: 'outline', size: 'sm' });
    return (
      <TooltipProvider>
        {/* Match the controls row's own gap-2 so a commit button sits the same
            distance from its neighbours as every other control. flex-wrap lets
            a multi-repo cluster break internally on a narrow card. */}
        <span className="inline-flex flex-wrap items-center gap-2">
          {repos.map((repo) => {
            const chip = buildCommitChip(repo, compareUrlByRepo[repo.name] ?? null);
            const showName = !singleRepo;
            const label = chip.shortHash != null
              ? (showName ? `${repo.name}: ${chip.shortHash}` : chip.shortHash)
              : repo.name;

            if (chip.linkable && chip.shortHash) {
              return (
                <Tooltip key={repo.name}>
                  <TooltipTrigger render={
                    <a href={chip.href!} target="_blank" rel="noopener noreferrer"
                      aria-label={`View ${repo.name} commit ${chip.shortHash} on GitHub`}
                      className={outlineClass} />
                  }>
                    <Github style={iconStyle} aria-hidden="true" />
                    {label}
                  </TooltipTrigger>
                  <TooltipContent>{repo.commit_hash} · View commit on GitHub</TooltipContent>
                </Tooltip>
              );
            }
            // Single-repo + not linkable → suppress entirely (FR-12: a lone icon conveys nothing).
            if (singleRepo) return null;
            // Multi-repo not-linkable: a commit that landed but has no compare/base
            // URL still shows its short hash; a genuinely absent commit reads as
            // "no commit yet". Both render as a non-interactive (disabled-looking)
            // button so the row's controls stay visually uniform.
            const landed = chip.shortHash != null;
            return (
              <Tooltip key={repo.name}>
                <TooltipTrigger render={
                  <span className={cn(outlineClass, 'cursor-not-allowed opacity-60')}
                    aria-disabled="true"
                    aria-label={landed ? `${repo.name} commit ${chip.shortHash} (link unavailable)` : `${repo.name} — no commit yet`} />
                }>
                  <Github style={iconStyle} aria-hidden="true" />
                  {label}
                </TooltipTrigger>
                <TooltipContent>{landed ? `${repo.commit_hash} · commit landed (link unavailable)` : `${repo.name} — no commit yet`}</TooltipContent>
              </Tooltip>
            );
          })}
        </span>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider>
      {/* flex-wrap lets a multi-repo cluster break internally once the controls
          row runs out of width, instead of overrunning the card edge. */}
      <span className="inline-flex flex-wrap items-center gap-3">
        {repos.map((repo) => {
          const chip = buildCommitChip(repo, compareUrlByRepo[repo.name] ?? null);
          const showName = !singleRepo;
          if (chip.linkable && chip.shortHash) {
            // The chip sits in the iteration-header trailing area alongside other
            // links (Doc/Compare/PR), not inside a roving-tabindex row with a
            // keydown handler — so it MUST stay in the natural tab order (no
            // tabIndex override) to be keyboard-reachable, mirroring the
            // DocumentLink convention enforced elsewhere in this folder.
            return (
              <Tooltip key={repo.name}>
                <TooltipTrigger render={
                  <a href={chip.href!} target="_blank" rel="noopener noreferrer"
                    aria-label={`View ${repo.name} commit ${chip.shortHash} on GitHub`}
                    className="inline-flex items-center gap-1 rounded-sm text-xs hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                }>
                  <Github className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                  {showName && <span className="text-muted-foreground">{repo.name}:</span>}
                  <span className="font-medium text-primary">{chip.shortHash}</span>
                </TooltipTrigger>
                <TooltipContent>{repo.commit_hash} · View commit on GitHub</TooltipContent>
              </Tooltip>
            );
          }
          // Single-repo + not linkable → suppress entirely (FR-12: a lone icon conveys nothing).
          if (singleRepo) return null;
          // Multi-repo not-linkable: a commit that landed but has no compare/base
          // URL still shows its short hash as plain text, so a real commit is NOT
          // misreported as "no commit yet". Only a genuinely absent commit (no
          // shortHash) renders the "no commit yet" state.
          const landed = chip.shortHash != null;
          return (
            <Tooltip key={repo.name}>
              <TooltipTrigger render={
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
                  aria-label={landed ? `${repo.name} commit ${chip.shortHash} (link unavailable)` : `${repo.name} — no commit yet`} />
              }>
                <Github className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{repo.name}{landed ? ':' : ''}</span>
                {landed && <span className="font-medium">{chip.shortHash}</span>}
              </TooltipTrigger>
              <TooltipContent>{landed ? `${repo.commit_hash} · commit landed (link unavailable)` : `${repo.name} — no commit yet`}</TooltipContent>
            </Tooltip>
          );
        })}
      </span>
    </TooltipProvider>
  );
}
