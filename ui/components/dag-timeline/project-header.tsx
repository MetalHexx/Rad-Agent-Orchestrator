"use client";

import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { PipelineTierBadge } from "@/components/badges";
import type {
  GraphStatus,
  GateMode,
  V5SourceControlState,
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

export function ProjectHeader({ projectName, tier, planningStatus, executionStatus, graphStatus, gateMode, currentPhaseName, progress, followMode, onToggleFollowMode, projectType }: ProjectHeaderProps) {
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
