"use client";

import { Trash2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PipelineTierBadge } from "@/components/badges";
import type { GraphStatus, GateMode } from '@/types/state';
import type { ProjectKind, ProjectState } from '@/types/components';
import { GateModeBadge } from '@/components/badges/gate-mode-badge';
import { ProjectKindBadge } from '@/components/badges/project-kind-badge';
import { KIND_PRESENTATION } from '@/components/badges/project-kind-presentation';

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

function followModeTooltip(on: boolean): string {
  if (on) {
    return 'Follow mode is on: the active iteration auto-expands and completed iterations collapse.';
  }
  return 'Follow mode is off. Click to re-engage and apply smart defaults.';
}

export interface ProjectHeaderProps {
  projectName: string;
  state?: ProjectState;
  stateLabel?: string;
  graphStatus?: GraphStatus;
  gateMode?: GateMode | null;
  currentPhaseName?: string | null;
  progress?: { completed: number; total: number } | null;
  followMode: boolean;
  onToggleFollowMode: () => void;
  projectType?: ProjectKind;
  onRequestDelete?: () => void;
  /** Absent → no toggle is rendered (a project with no pipeline has nothing to switch to). */
  viewMode?: 'overview' | 'pipeline';
  onViewModeChange?: (mode: 'overview' | 'pipeline') => void;
}

export function ProjectHeader({ projectName, state, stateLabel, graphStatus, gateMode, currentPhaseName, progress, followMode, onToggleFollowMode, projectType, onRequestDelete, viewMode, onViewModeChange }: ProjectHeaderProps) {
  return (
    <header className="border-b border-border px-6 py-4" aria-label={`Project ${projectName}`}>
      <TooltipProvider>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-lg font-semibold">{projectName}</span>
          {KIND_PRESENTATION[projectType ?? 'standard'].replacesStateBadge ? (
            <Tooltip>
              <TooltipTrigger render={<ProjectKindBadge projectType={projectType} />} />
              <TooltipContent>
                Portfolio: holds the design documents for a long-running initiative. It never executes — its iterations are separate projects beside it, not inside it.
              </TooltipContent>
            </Tooltip>
          ) : (
            <>
              {state && stateLabel !== undefined && (
                <PipelineTierBadge state={state} label={stateLabel} />
              )}
              {(projectType ?? 'standard') === 'side-project' && (
                <Tooltip>
                  <TooltipTrigger render={<ProjectKindBadge projectType={projectType} />} />
                  <TooltipContent>
                    Side-project: a local-only git repo under ~/.radorc/side-projects/. Commits stay on your machine — never pushed, no PR.
                  </TooltipContent>
                </Tooltip>
              )}
            </>
          )}
          {gateMode !== undefined && (
            <Tooltip>
              <TooltipTrigger render={<GateModeBadge mode={gateMode} />} />
              <TooltipContent>{gateModeTooltip(gateMode ?? null)}</TooltipContent>
            </Tooltip>
          )}
          {onRequestDelete && (
            <Tooltip>
              <TooltipTrigger render={
                <button
                  type="button"
                  aria-label={`Delete project ${projectName}`}
                  onClick={onRequestDelete}
                  className="cursor-pointer rounded-md p-1.5 text-muted-foreground hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </button>
              } />
              <TooltipContent>Delete project</TooltipContent>
            </Tooltip>
          )}
          <div className="ml-auto inline-flex items-center gap-2">
            {viewMode === 'pipeline' && (
              <>
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
              </>
            )}
            {viewMode !== undefined && (
              <ToggleGroup
                value={[viewMode]}
                onValueChange={(values) => { if (values.length > 0) onViewModeChange?.(values[0] as 'overview' | 'pipeline'); }}
                variant="outline"
                size="sm"
                aria-label="Project view"
              >
                <ToggleGroupItem value="overview">Overview</ToggleGroupItem>
                <ToggleGroupItem value="pipeline">Pipeline</ToggleGroupItem>
              </ToggleGroup>
            )}
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
