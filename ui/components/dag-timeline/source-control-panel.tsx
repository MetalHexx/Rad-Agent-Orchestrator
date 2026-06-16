"use client";
import { useState, useCallback } from 'react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Hexagon, Box, HardDrive, Folder, FolderX } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { BindStateDot } from '@/components/repo-registry/bind-state-dot';
import { ExternalLink } from '@/components/documents';
import { postOpenFolder } from '@/hooks/use-open-folder';
import { SECTION_LABEL_CLASSES, CARD_SHELL_CLASSES } from './dag-section-group';
import { resolveLocationKind, resolveRepoFolderPath, LOCATION_KIND_LABEL } from './source-control-helpers';
import type { RepoBindInfo } from './source-control-bind';
import type { SourceControlRepo, V5AutoCommit, V5AutoPR } from '@/types/state';

export interface SourceControlPanelProps {
  repos: SourceControlRepo[];
  projectName: string;
  projectType?: 'standard' | 'side-project';
  autoCommit?: V5AutoCommit;
  autoPr?: V5AutoPR;
  bindByName: Record<string, RepoBindInfo>;
}

function pillCssVar(v: V5AutoCommit | V5AutoPR | undefined): string {
  return v === 'always' ? '--status-complete' : v === 'ask' ? '--status-in-progress' : '--status-failed';
}

// SC-PANEL-POLISH: display-only verdict — show a locked Yes/No, and hide the
// badge entirely while the policy is still `ask`/unset. State is untouched.
function policyVerdict(v: V5AutoCommit | V5AutoPR | undefined): 'Yes' | 'No' | null {
  return v === 'always' ? 'Yes' : v === 'never' ? 'No' : null;
}

// DD-5: location-kind pill icon (lucide) — hexagon / box / hard-drive.
const LOCATION_KIND_ICON = { worktree: Hexagon, 'in-place': Box, 'side-project': HardDrive } as const;

function parsePrNumber(url: string): string {
  const m = url.match(/\/pull\/(\d+)/);
  return m ? `PR #${m[1]}` : 'PR';
}

/**
 * SC-PANEL-POLISH: a simple link that opens the repo folder in the OS file
 * explorer (Explorer / Finder / file-manager) via the guarded local endpoint.
 * No clipboard copy, no checkmark. A missing folder renders disabled.
 */
function FolderOpenButton({ path, label, missing, projectName }: { path: string; label: string; missing: boolean; projectName: string }) {
  const [failed, setFailed] = useState(false);
  const onOpen = useCallback(async () => {
    setFailed(false);
    const res = await postOpenFolder(projectName, path);
    if (!res.success) { setFailed(true); setTimeout(() => setFailed(false), 3000); }
  }, [projectName, path]);

  if (missing) {
    return (
      <Tooltip>
        <TooltipTrigger render={
          <span aria-label={`Folder is missing: ${path}`}
            className="inline-flex items-center gap-1.5 rounded-sm text-sm text-[var(--color-warning)]" />
        }>
          <FolderX className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="max-w-[200px] truncate">{label}</span>
        </TooltipTrigger>
        <TooltipContent>Folder is missing at {path}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger render={
        <button type="button" onClick={onOpen} aria-label={`Open folder in file explorer: ${path}`}
          className="inline-flex items-center gap-1.5 rounded-sm text-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
      }>
        <Folder className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {/* visible label is the (truncated) folder path, not the word "Folder" */}
        <span className="max-w-[200px] truncate">{label}</span>
      </TooltipTrigger>
      <TooltipContent>{failed ? `Couldn't open ${path}` : `Open ${path} in file explorer`}</TooltipContent>
    </Tooltip>
  );
}

export function SourceControlPanel({ repos, projectName, projectType, autoCommit, autoPr, bindByName }: SourceControlPanelProps) {
  if (!repos || repos.length === 0) return null; // FR-3 safety net (page also gates)
  const panelKind = resolveLocationKind(projectType, repos.length > 0 && repos.every((r) => r.in_place === true));
  const LocIcon = LOCATION_KIND_ICON[panelKind];
  // SC-PANEL-POLISH: locked Yes/No verdicts; null → badge hidden (ask/unset).
  const commitVerdict = policyVerdict(autoCommit);
  const prVerdict = policyVerdict(autoPr);

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
            {commitVerdict && (
              <Tooltip>
                <TooltipTrigger render={<Badge variant="outline" style={{ color: `var(${pillCssVar(autoCommit)})`, borderColor: `var(${pillCssVar(autoCommit)})` }} aria-label={`auto-commit ${commitVerdict}`} />}>auto-commit: {commitVerdict}</TooltipTrigger>
                <TooltipContent>Auto-Commit: {commitVerdict}</TooltipContent>
              </Tooltip>
            )}
            {prVerdict && (
              <Tooltip>
                <TooltipTrigger render={<Badge variant="outline" style={{ color: `var(${pillCssVar(autoPr)})`, borderColor: `var(${pillCssVar(autoPr)})` }} aria-label={`auto-pr ${prVerdict}`} />}>auto-pr: {prVerdict}</TooltipTrigger>
                <TooltipContent>Auto-PR: {prVerdict}</TooltipContent>
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
                  {/* branch → base (DD-6: page font, no monospace); FR-10: side-project shows branch only */}
                  <span className="text-sm text-muted-foreground">{repo.branch}{!isSide && <> → {repo.base_branch}</>}</span>
                  {/* Trailing actions (Folder / Compare / PR) — FR-7, FR-8, FR-9, DD-4 */}
                  {(() => {
                    const folderPath = resolveRepoFolderPath({ locationKind: kind, projectName, repoName: repo.name, registryPath: bind?.path ?? null });
                    const folderLabel = kind === 'worktree' ? `${projectName}/${repo.name}` : folderPath;
                    const missing = bind?.state === 'missing';
                    return (
                      <div className="ml-auto flex items-center gap-3">
                        {/* DD-4 trailing order: Folder → Compare → PR */}
                        <FolderOpenButton path={folderPath} label={folderLabel} missing={missing} projectName={projectName} />
                        {!isSide && repo.compare_url && (
                          <Tooltip>
                            <TooltipTrigger render={<span className="inline-flex" />}>
                              <ExternalLink href={repo.compare_url} label="Compare" icon="github" />
                            </TooltipTrigger>
                            <TooltipContent>Compare {repo.branch} vs {repo.base_branch}</TooltipContent>
                          </Tooltip>
                        )}
                        {/* PR: worktree → link or muted "No PR"; in-place → always "No PR (in-place)"; side-project → nothing (FR-8, FR-10, DD-4) */}
                        {!isSide && (
                          kind === 'in-place' ? (
                            <ExternalLink href={null} label="No PR (in-place)" icon="git-pull-request" />
                          ) : repo.pr_url ? (
                            <Tooltip>
                              <TooltipTrigger render={<span className="inline-flex" />}>
                                <ExternalLink href={repo.pr_url} label={parsePrNumber(repo.pr_url)} icon="git-pull-request" />
                              </TooltipTrigger>
                              <TooltipContent>{parsePrNumber(repo.pr_url)} · open</TooltipContent>
                            </Tooltip>
                          ) : (
                            <ExternalLink href={null} label="No PR" icon="git-pull-request" />
                          )
                        )}
                      </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        </div>
      </TooltipProvider>
    </div>
  );
}
