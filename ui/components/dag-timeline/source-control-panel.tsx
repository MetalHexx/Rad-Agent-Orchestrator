"use client";
import { useState, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Box, HardDrive, Folder, FolderX, GitPullRequest, Github } from 'lucide-react';
import { BindStateDot } from '@/components/repo-registry/bind-state-dot';
import { postOpenFolder } from '@/hooks/use-open-folder';
import { cn } from '@/lib/utils';
import { SECTION_LABEL_CLASSES } from './dag-section-group';
import { resolveLocationKind, resolveRepoFolderPath } from './source-control-helpers';
import type { LocationKind } from './source-control-helpers';
import type { RepoBindInfo } from './source-control-bind';
import type { SourceControlRepo, V5AutoCommit, V5AutoPR } from '@/types/state';
import type { ProjectKind } from '@/types/components';

export interface SourceControlPanelProps {
  repos: SourceControlRepo[];
  projectName: string;
  projectType?: ProjectKind;
  /** Retained for the prop contract; the panel renders no auto-commit surface. */
  autoCommit?: V5AutoCommit;
  autoPr?: V5AutoPR;
  bindByName: Record<string, RepoBindInfo>;
}

/**
 * A location chip is an exception marker: a worktree is the norm and earns no
 * chip, so only the two exceptional kinds are mapped here.
 */
const LOCATION_CHIP = {
  'in-place': { label: 'In-place', Icon: Box },
  'side-project': { label: 'Side-project', Icon: HardDrive },
} as const;

/**
 * The four tracks, in render order: repo · branch · worktree/location ·
 * pull-request. At full width the first two and the last size to their own
 * content; the worktree/location track — third, so it can freely take
 * whatever room is left — fills the remainder, and the pull-request track
 * hugs the card's right edge. Rows and the header are `grid-cols-subgrid`
 * children of `PANEL_GRID_CLASSES` below so their cells share one set of
 * column tracks; that alignment is what makes content-based sizing possible
 * across rows.
 */
const PANEL_GRID_CLASSES =
  'grid grid-cols-[minmax(0,max-content)_minmax(0,max-content)_minmax(0,1fr)_minmax(0,max-content)]';

/**
 * Applied to the header row and to each repo row. At full width every row
 * subgrids into the panel's shared column tracks; the two container-width
 * reflows below drop subgrid for an explicit self-contained template, since
 * a stacked label/value row no longer needs to align with its neighbors.
 */
const ROW_GRID_CLASSES = [
  'grid grid-cols-subgrid col-span-full gap-x-3',
  '@max-[860px]/sc:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] @max-[860px]/sc:gap-y-2.5',
  '@max-[560px]/sc:grid-cols-[minmax(0,1fr)]',
].join(' ');

const CELL_CLASSES =
  'flex min-w-0 items-center gap-2 @max-[860px]/sc:flex-col @max-[860px]/sc:items-start @max-[860px]/sc:gap-1';
/**
 * The pull-request cell hugs the card's right edge at full width, alongside
 * the right-aligned header above it; the reflow at 860px stacks every cell
 * left-aligned, so `justify-end` is undone by the same variant.
 */
const PR_CELL_CLASSES = cn(CELL_CLASSES, 'justify-end @max-[860px]/sc:justify-start');
const CELL_INNER_CLASSES = 'flex min-w-0 max-w-full items-center gap-2';
const CELL_KEY_CLASSES =
  'hidden text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground @max-[860px]/sc:block';
/**
 * A non-interactive control keeps the real button's box metrics — the 1px
 * border and the inline padding — so its glyph lands on the same vertical line
 * as the button in the row above and the column doesn't read ragged.
 */
const INERT_CONTROL_CLASSES =
  'border-transparent bg-transparent hover:bg-transparent ' +
  'dark:border-transparent dark:bg-transparent dark:hover:bg-transparent';
const CONTROL_LABEL_CLASSES = 'min-w-0 truncate';

const CONTROL_SIZING_CLASSES = 'min-w-0 max-w-full';
/**
 * The folder control is the one that gives: `shrink` undoes the house Button's
 * `shrink-0` so a long path ellipsises inside its cell instead of overflowing
 * the row. Every other control keeps its full short label.
 */
const YIELDING_CONTROL_CLASSES = `${CONTROL_SIZING_CLASSES} shrink`;

/** House outline/sm button chrome, sized to whatever room its cell has left. */
function controlClasses(...extra: string[]): string {
  return cn(buttonVariants({ variant: 'outline', size: 'sm' }), CONTROL_SIZING_CLASSES, ...extra);
}

function parsePrNumber(url: string): string {
  const m = url.match(/\/pull\/(\d+)/);
  return m ? `PR #${m[1]}` : 'PR';
}

/**
 * When the OS file explorer can't be opened, name the folder so the user can
 * navigate to it manually. The server never echoes absolute paths, so the
 * message carries the path the client already holds.
 */
export function buildFolderOpenError(path: string): string {
  return `Couldn't open the folder in your file explorer. Navigate to it directly: ${path}`;
}

/**
 * The pull-request cell's single control, in one ordered precedence chain —
 * the first matching rule wins and no later rule is consulted. `null` means
 * the cell renders empty (a side-project has nothing to show here).
 */
type PrControl =
  | { kind: 'pr-link'; label: string; href: string }
  | { kind: 'compare-link'; href: string }
  | { kind: 'status'; label: string };

function resolvePrControl(
  repo: SourceControlRepo,
  kind: LocationKind,
  autoPr: V5AutoPR | undefined
): PrControl | null {
  if (kind === 'side-project') return null;
  if (repo.pr_url) return { kind: 'pr-link', label: parsePrNumber(repo.pr_url), href: repo.pr_url };
  if (kind === 'in-place') return { kind: 'status', label: 'No PR (in-place)' };
  if (repo.compare_url) return { kind: 'compare-link', href: repo.compare_url };
  if (autoPr === 'always') return { kind: 'status', label: 'Opens automatically' };
  if (autoPr === 'ask') return { kind: 'status', label: 'No PR yet' };
  return { kind: 'status', label: 'No PR' };
}

/**
 * Opens the repo's folder in the OS file explorer via the guarded local
 * endpoint. A missing folder renders as a non-interactive warning treatment; a
 * failed open is reported up through `onResult` to the panel-level alert.
 */
function FolderOpenButton({
  path,
  missing,
  projectName,
  onResult,
}: {
  path: string;
  missing: boolean;
  projectName: string;
  onResult: (error: string | null) => void;
}) {
  const onOpen = useCallback(async () => {
    onResult(null); // clear any prior error on a fresh attempt
    const res = await postOpenFolder(projectName, path);
    if (!res.success) onResult(buildFolderOpenError(path));
  }, [projectName, path, onResult]);

  if (missing) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              aria-disabled="true"
              aria-label={`Folder is missing: ${path}`}
              className={controlClasses(INERT_CONTROL_CLASSES, 'shrink cursor-default text-[var(--color-warning)]')}
            />
          }
        >
          <FolderX aria-hidden="true" />
          <span className={CONTROL_LABEL_CLASSES}>{path}</span>
        </TooltipTrigger>
        <TooltipContent>Folder is missing at {path}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onOpen}
            aria-label={`Open folder in file explorer: ${path}`}
            className={YIELDING_CONTROL_CLASSES}
          />
        }
      >
        <Folder aria-hidden="true" />
        <span className={CONTROL_LABEL_CLASSES}>{path}</span>
      </TooltipTrigger>
      <TooltipContent>Open {path} in file explorer</TooltipContent>
    </Tooltip>
  );
}

export function SourceControlPanel({ repos, projectName, projectType, autoPr, bindByName }: SourceControlPanelProps) {
  // Panel-level inline alert for a failed file-explorer open (latest attempt wins).
  const [folderError, setFolderError] = useState<string | null>(null);
  if (!repos || repos.length === 0) return null;

  const kinds = repos.map((r) => resolveLocationKind(projectType, r.in_place));
  // The third column is only "Worktree" while every row actually is one.
  const locationHeader = kinds.every((k) => k === 'worktree') ? 'Worktree' : 'Location';
  // An all-side-project panel keeps the fourth track, but has nothing to name it.
  const showPrHeader = kinds.some((k) => k !== 'side-project');

  return (
    <div role="group" aria-label="Source Control section" className="@container/sc">
      <TooltipProvider>
        <div aria-hidden="true" className={SECTION_LABEL_CLASSES}>Source Control</div>
        <Card className="gap-0 py-2">
          <div className={cn(PANEL_GRID_CLASSES, 'px-3')}>
            <div
              className={cn(
                ROW_GRID_CLASSES,
                'items-center border-b border-border mb-2 pt-1 pb-2',
                'text-[10.5px] font-medium uppercase tracking-[0.09em] text-muted-foreground',
                '@max-[860px]/sc:hidden'
              )}
            >
              <div>Repo</div>
              <div>Branch</div>
              <div>{locationHeader}</div>
              <div className="text-right">{showPrHeader ? 'Pull Request' : null}</div>
            </div>
            {repos.map((repo, index) => {
              const kind = kinds[index];
              const isSide = kind === 'side-project';
              const bind = bindByName[repo.name];
              const chip = kind === 'worktree' ? null : LOCATION_CHIP[kind];
              const folderPath = resolveRepoFolderPath({
                locationKind: kind,
                projectName,
                repoName: repo.name,
                registryPath: bind?.path ?? null,
              });
              const pr = resolvePrControl(repo, kind, autoPr);

              return (
                <div
                  key={repo.name}
                  data-location-kind={kind}
                  className={cn(
                    ROW_GRID_CLASSES,
                    'mx-1.5 my-0.5 items-center rounded-md px-1.5 py-2 hover:bg-accent/50',
                    '@max-[860px]/sc:items-start @max-[860px]/sc:px-2 @max-[860px]/sc:py-2.5'
                  )}
                >
                  <div className={CELL_CLASSES}>
                    <span className={CELL_KEY_CLASSES}>Repo</span>
                    <span className={CELL_INNER_CLASSES}>
                      {!isSide && bind && (
                        <Tooltip>
                          <TooltipTrigger render={<span className="inline-flex shrink-0" />}>
                            <BindStateDot state={bind.state} />
                          </TooltipTrigger>
                          <TooltipContent>{bind.path ? `${bind.state} · ${bind.path}` : bind.state}</TooltipContent>
                        </Tooltip>
                      )}
                      {isSide ? (
                        <span className="truncate text-sm font-medium">{repo.name}</span>
                      ) : (
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <a
                                href={`/repo-registry?repo=${encodeURIComponent(repo.name)}`}
                                aria-label={`Open ${repo.name} in Repo Registry`}
                                className="truncate rounded-sm text-sm font-medium text-foreground hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              />
                            }
                          >
                            {repo.name}
                          </TooltipTrigger>
                          <TooltipContent>Open {repo.name} in Repo Registry</TooltipContent>
                        </Tooltip>
                      )}
                      {chip && (
                        <Badge variant="outline" className="shrink-0 gap-1">
                          <chip.Icon aria-hidden="true" />
                          {chip.label}
                        </Badge>
                      )}
                    </span>
                  </div>

                  <div className={CELL_CLASSES}>
                    <span className={CELL_KEY_CLASSES}>Branch</span>
                    <span className="min-w-0 max-w-full truncate text-sm text-muted-foreground @max-[860px]/sc:overflow-visible @max-[860px]/sc:whitespace-normal @max-[860px]/sc:[overflow-wrap:anywhere]">
                      {repo.branch}
                      {!isSide && <> → {repo.base_branch}</>}
                    </span>
                  </div>

                  <div className={CELL_CLASSES}>
                    <span className={CELL_KEY_CLASSES}>{locationHeader}</span>
                    <span className={CELL_INNER_CLASSES}>
                      <FolderOpenButton
                        path={folderPath}
                        missing={bind?.state === 'missing'}
                        projectName={projectName}
                        onResult={setFolderError}
                      />
                    </span>
                  </div>

                  {/* The pull-request cell resolves to exactly one control — a PR link,
                      a Compare link standing in until one exists, or a status message. */}
                  <div className={PR_CELL_CLASSES}>
                    {pr && (
                      <span className={CELL_INNER_CLASSES}>
                        {pr.kind === 'pr-link' && (
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <a
                                  href={pr.href}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  aria-label={pr.label}
                                  className={controlClasses()}
                                />
                              }
                            >
                              <GitPullRequest aria-hidden="true" />
                              <span className={CONTROL_LABEL_CLASSES}>{pr.label}</span>
                            </TooltipTrigger>
                            <TooltipContent>{pr.label} · open</TooltipContent>
                          </Tooltip>
                        )}
                        {pr.kind === 'compare-link' && (
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <a
                                  href={pr.href}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  aria-label={`Compare ${repo.branch} with ${repo.base_branch}`}
                                  className={controlClasses()}
                                />
                              }
                            >
                              <Github aria-hidden="true" />
                              <span className={CONTROL_LABEL_CLASSES}>Compare</span>
                            </TooltipTrigger>
                            <TooltipContent>
                              Compare {repo.branch} vs {repo.base_branch}
                            </TooltipContent>
                          </Tooltip>
                        )}
                        {pr.kind === 'status' && (
                          <span
                            aria-disabled="true"
                            className={controlClasses(
                              INERT_CONTROL_CLASSES,
                              'cursor-not-allowed text-muted-foreground'
                            )}
                          >
                            <GitPullRequest aria-hidden="true" />
                            <span className={CONTROL_LABEL_CLASSES}>{pr.label}</span>
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {folderError && (
            <p role="alert" className="mt-2 border-t border-border/50 px-4 py-2 text-xs text-destructive">
              {folderError}
            </p>
          )}
        </Card>
      </TooltipProvider>
    </div>
  );
}
