"use client";

import { Github, Clock, XCircle } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { SpinnerBadge, PipelineTierBadge } from "@/components/badges";
import type {
  GraphStatus,
  GateMode,
  V5SourceControlState,
  V5AutoCommit,
  V5AutoPR,
  PipelineTier,
  PlanningStatus,
  ExecutionStatus,
} from '@/types/state';
import { GateModeBadge } from '@/components/badges/gate-mode-badge';
import { ProjectKindBadge } from '@/components/badges/project-kind-badge';

function gateModeTooltip(mode: GateMode | null): string {
  if (mode === null) {
    return 'Global default: project-wide gate mode applies (no per-pipeline override).';
  }
  switch (mode) {
    case 'task':
      return 'Task gate: approval requested after each task.';
    case 'phase':
      return 'Phase gate: approval requested after each phase.';
    case 'autonomous':
      return 'Autonomous: pipeline proceeds without manual approval.';
  }
}

function autoCommitTooltip(v: V5AutoCommit): string {
  switch (v) {
    case 'always':
      return 'Auto-Commit is on: commits are created after each iteration.';
    case 'ask':
      return 'Auto-Commit prompts before each iteration.';
    case 'never':
      return 'Auto-Commit is off: commits must be made manually.';
  }
}

function autoPrTooltip(v: V5AutoPR): string {
  switch (v) {
    case 'always':
      return 'Auto-PR is on: a pull request is created when phases complete.';
    case 'ask':
      return 'Auto-PR prompts before creating a pull request.';
    case 'never':
      return 'Auto-PR is off: no pull request will be created automatically.';
  }
}

function branchTooltip(branch: string, hasLink: boolean): string {
  if (hasLink) {
    return `Open branch comparison on GitHub: ${branch}`;
  }
  return `Branch: ${branch} (no compare link available)`;
}

function prStateTooltip(prUrl: string | null): string {
  if (prUrl === null) {
    return 'Pull request has not yet been created; it will be created when phases complete.';
  }
  if (/^https?:\/\//i.test(prUrl)) {
    return 'Open the existing pull request.';
  }
  return 'Pull request creation failed; check project logs for details.';
}

function followModeTooltip(on: boolean): string {
  if (on) {
    return 'Follow mode is on: the active iteration auto-expands and completed iterations collapse.';
  }
  return 'Follow mode is off. Click to re-engage and apply smart defaults.';
}

export interface ProjectHeaderProps {
  projectName: string;
  tier?: PipelineTier | 'not_initialized';
  planningStatus?: PlanningStatus;
  executionStatus?: ExecutionStatus;
  graphStatus?: GraphStatus;
  gateMode?: GateMode | null;
  currentPhaseName?: string | null;
  progress?: { completed: number; total: number } | null;
  sourceControl: V5SourceControlState | null;
  followMode: boolean;
  onToggleFollowMode: () => void;
  projectType?: 'standard' | 'side-project';
}

export function ProjectHeader({ projectName, tier, planningStatus, executionStatus, graphStatus, gateMode, currentPhaseName, progress, sourceControl, followMode, onToggleFollowMode, projectType }: ProjectHeaderProps) {
  const branch = sourceControl?.branch;
  const compare_url = sourceControl?.compare_url ?? null;
  const auto_commit = sourceControl?.auto_commit;
  const auto_pr = sourceControl?.auto_pr;
  const pr_url = sourceControl?.pr_url;
  const compareLink: string | null =
    compare_url !== null && compare_url !== undefined && /^https?:\/\//i.test(compare_url) ? compare_url : null;

  return (
    <header className="border-b border-border px-6 py-4" aria-label={`Project ${projectName}`}>
      <TooltipProvider>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-lg font-semibold">{projectName}</span>
          {tier && (
            <PipelineTierBadge
              tier={tier}
              planningStatus={planningStatus}
              executionStatus={executionStatus}
            />
          )}
          {(projectType ?? 'standard') === 'side-project' && (
            <Tooltip>
              <TooltipTrigger render={<ProjectKindBadge projectType={projectType} />} />
              <TooltipContent>
                Side-project: a local-only git repo under ~/.radorc/side-projects/. Commits stay on your machine — never pushed, no PR.
              </TooltipContent>
            </Tooltip>
          )}
          {gateMode !== undefined && (
            <Tooltip>
              <TooltipTrigger render={<GateModeBadge mode={gateMode} />} />
              <TooltipContent>{gateModeTooltip(gateMode ?? null)}</TooltipContent>
            </Tooltip>
          )}
          {sourceControl !== null && (
            <>
              {/* Configuration badges */}
              <Tooltip>
                <TooltipTrigger render={
                  <SpinnerBadge
                    label="Auto-Commit"
                    cssVar={
                      auto_commit === 'always'
                        ? '--status-complete'
                        : auto_commit === 'ask'
                        ? '--status-in-progress'
                        : '--status-failed'
                    }
                    isSpinning={false}
                    isComplete={auto_commit === 'always'}
                    isRejected={auto_commit === 'never'}
                    ariaLabel={`Auto-Commit: ${auto_commit}`}
                  />
                } />
                <TooltipContent>{autoCommitTooltip(auto_commit!)}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger render={
                  <SpinnerBadge
                    label="Auto-PR"
                    cssVar={
                      auto_pr === 'always'
                        ? '--status-complete'
                        : auto_pr === 'ask'
                        ? '--status-in-progress'
                        : '--status-failed'
                    }
                    isSpinning={false}
                    isComplete={auto_pr === 'always'}
                    isRejected={auto_pr === 'never'}
                    ariaLabel={`Auto-PR: ${auto_pr}`}
                  />
                } />
                <TooltipContent>{autoPrTooltip(auto_pr!)}</TooltipContent>
              </Tooltip>

              {/* Branch region */}
              {compareLink !== null ? (
                <Tooltip>
                  <TooltipTrigger render={
                    <a
                      href={compareLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-primary hover:underline font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
                      aria-label={`View ${branch} branch diff on GitHub`}
                    >
                      <Github size={12} aria-hidden="true" />
                      {branch}
                    </a>
                  } />
                  <TooltipContent>{branchTooltip(branch!, compareLink !== null)}</TooltipContent>
                </Tooltip>
              ) : (
                <Tooltip>
                  <TooltipTrigger render={
                    <span className="inline-flex items-center gap-1 text-muted-foreground font-mono">
                      <Github size={12} aria-hidden="true" />
                      {branch}
                    </span>
                  } />
                  <TooltipContent>{branchTooltip(branch!, compareLink !== null)}</TooltipContent>
                </Tooltip>
              )}

              {/* PR status region — only when auto_pr === 'always' */}
              {auto_pr === 'always' && (
                pr_url !== null && pr_url !== undefined && /^https?:\/\//i.test(pr_url) ? (
                  <Tooltip>
                    <TooltipTrigger render={
                      <a
                        href={pr_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
                        aria-label="View pull request on GitHub"
                      >
                        <Github size={12} aria-hidden="true" />
                        Pull Request
                      </a>
                    } />
                    <TooltipContent>{prStateTooltip(pr_url ?? null)}</TooltipContent>
                  </Tooltip>
                ) : (pr_url === null || pr_url === undefined) ? (
                  <Tooltip>
                    <TooltipTrigger render={
                      <span
                        className="inline-flex items-center gap-1 text-muted-foreground italic"
                        aria-label="Pull request not yet created"
                      >
                        <Clock
                          size={12}
                          style={{ color: 'var(--status-not-started)' }}
                          aria-hidden="true"
                        />
                        PR not yet created
                      </span>
                    } />
                    <TooltipContent>{prStateTooltip(pr_url ?? null)}</TooltipContent>
                  </Tooltip>
                ) : (
                  <Tooltip>
                    <TooltipTrigger render={
                      <span
                        className="inline-flex items-center gap-1 text-destructive italic"
                        aria-label="Pull request creation failed"
                      >
                        <XCircle
                          size={12}
                          className="text-destructive"
                          aria-hidden="true"
                        />
                        PR creation failed
                      </span>
                    } />
                    <TooltipContent>{prStateTooltip(pr_url ?? null)}</TooltipContent>
                  </Tooltip>
                )
              )}
            </>
          )}
          <div className="ml-auto inline-flex items-center gap-2">
            <label htmlFor="follow-mode-switch">Follow Mode</label>
            <Tooltip>
              <TooltipTrigger render={
                <Switch
                  id="follow-mode-switch"
                  checked={followMode}
                  onCheckedChange={() => onToggleFollowMode()}
                  className="cursor-pointer"
                />
              } />
              <TooltipContent>{followModeTooltip(followMode)}</TooltipContent>
            </Tooltip>
          </div>
        </div>
        {graphStatus === 'in_progress' && currentPhaseName && (
          <div className="flex items-center gap-3 mt-1">
            <span className="text-sm text-muted-foreground">{currentPhaseName}</span>
            {progress && (
              <span className="text-sm text-muted-foreground">
                {progress.completed} of {progress.total} phases
              </span>
            )}
          </div>
        )}
      </TooltipProvider>
    </header>
  );
}
