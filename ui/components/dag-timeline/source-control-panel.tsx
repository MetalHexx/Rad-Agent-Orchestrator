"use client";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Hexagon, Box, HardDrive } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { BindStateDot } from '@/components/repo-registry/bind-state-dot';
import { SECTION_LABEL_CLASSES, CARD_SHELL_CLASSES } from './dag-section-group';
import { resolveLocationKind, resolveRepoFolderPath, LOCATION_KIND_LABEL } from './source-control-helpers';
import type { RepoBindInfo } from './source-control-bind';
import type { V5SourceControlRepoEntry, V5AutoCommit, V5AutoPR } from '@/types/state';

export interface SourceControlPanelProps {
  repos: V5SourceControlRepoEntry[];
  projectName: string;
  projectType?: 'standard' | 'side-project';
  autoCommit?: V5AutoCommit;
  autoPr?: V5AutoPR;
  bindByName: Record<string, RepoBindInfo>;
}

function pillCssVar(v: V5AutoCommit | V5AutoPR | undefined): string {
  return v === 'always' ? '--status-complete' : v === 'ask' ? '--status-in-progress' : '--status-failed';
}

// DD-5: location-kind pill icon (lucide) — hexagon / box / hard-drive.
const LOCATION_KIND_ICON = { worktree: Hexagon, 'in-place': Box, 'side-project': HardDrive } as const;

export function SourceControlPanel({ repos, projectName, projectType, autoCommit, autoPr, bindByName }: SourceControlPanelProps) {
  if (!repos || repos.length === 0) return null; // FR-3 safety net (page also gates)
  const panelKind = resolveLocationKind(projectType, repos.length > 0 && repos.every((r) => r.in_place === true));
  const LocIcon = LOCATION_KIND_ICON[panelKind];

  return (
    <div role="group" aria-label="Source Control section">
      <TooltipProvider>
        {/* DD-5: section-label row carries the label + right-aligned loc-badge + value-text policy pills (not a card header) */}
        <div className="mb-1 flex items-center gap-2">
          <span aria-hidden="true" className={SECTION_LABEL_CLASSES}>Source Control</span>
          <div className="ml-auto flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger render={
                <Badge variant="outline" className="gap-1.5" aria-label={`Location kind: ${LOCATION_KIND_LABEL[panelKind]}`} />
              }>
                <LocIcon className="h-3 w-3" aria-hidden="true" />
                {LOCATION_KIND_LABEL[panelKind]}
              </TooltipTrigger>
              <TooltipContent>Where this project&apos;s work physically lives: {LOCATION_KIND_LABEL[panelKind]}</TooltipContent>
            </Tooltip>
            {autoCommit && (
              <Tooltip>
                <TooltipTrigger render={<Badge variant="outline" style={{ color: `var(${pillCssVar(autoCommit)})`, borderColor: `var(${pillCssVar(autoCommit)})` }} aria-label={`auto-commit ${autoCommit}`} />}>auto-commit: {autoCommit}</TooltipTrigger>
                <TooltipContent>Auto-Commit: {autoCommit}</TooltipContent>
              </Tooltip>
            )}
            {autoPr && (
              <Tooltip>
                <TooltipTrigger render={<Badge variant="outline" style={{ color: `var(${pillCssVar(autoPr)})`, borderColor: `var(${pillCssVar(autoPr)})` }} aria-label={`auto-pr ${autoPr}`} />}>auto-pr: {autoPr}</TooltipTrigger>
                <TooltipContent>Auto-PR: {autoPr}</TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
        <div className={CARD_SHELL_CLASSES}>
          <div className="py-2">
            {repos.map((repo) => {
              const kind = resolveLocationKind(projectType, repo.in_place);
              const isSide = kind === 'side-project';
              const bind = bindByName[repo.name];
              return (
                <div key={repo.name} className="flex items-center gap-2 rounded-md py-2 pl-3 pr-3 hover:bg-accent/50" data-location-kind={kind}>
                  {/* Leading bind dot — omitted for side-projects (FR-5, FR-10, DD-2) */}
                  {!isSide && bind && (
                    <Tooltip>
                      <TooltipTrigger render={<span className="inline-flex shrink-0" />}><BindStateDot state={bind.state} /></TooltipTrigger>
                      <TooltipContent>{bind.path ? `${bind.state} · ${bind.path}` : bind.state}</TooltipContent>
                    </Tooltip>
                  )}
                  {/* Repo name — registry deep link; plain text for side-projects (FR-6) */}
                  {isSide ? (
                    <span className="text-sm font-medium">{repo.name}</span>
                  ) : (
                    <Tooltip>
                      <TooltipTrigger render={<a href={`/repo-registry?repo=${encodeURIComponent(repo.name)}`} className="rounded-sm text-sm font-medium text-foreground hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Open ${repo.name} in Repo Registry`} />}>{repo.name}</TooltipTrigger>
                      <TooltipContent>Open {repo.name} in Repo Registry</TooltipContent>
                    </Tooltip>
                  )}
                  {/* branch → base (DD-6: page font, no monospace) */}
                  <span className="text-sm text-muted-foreground">{repo.branch} → {repo.base_branch}</span>
                  {/* Trailing actions (Folder / Compare / PR) added in P03-T02 */}
                </div>
              );
            })}
          </div>
        </div>
      </TooltipProvider>
    </div>
  );
}
