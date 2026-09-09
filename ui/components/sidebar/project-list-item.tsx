"use client";

import type { ProjectSummary } from "@/types/components";
import { PipelineTierBadge, WarningBadge } from "@/components/badges";
import { ProjectKindBadge } from "@/components/badges/project-kind-badge";
import { KIND_PRESENTATION } from "@/components/badges/project-kind-presentation";

interface ProjectListItemProps {
  project: ProjectSummary;
  selected: boolean;
  onClick: () => void;
}

export function ProjectListItem({
  project,
  selected,
  onClick,
}: ProjectListItemProps) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      aria-current={selected ? "true" : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onClick();
        }
      }}
      className={`flex w-full items-center justify-between gap-1 rounded-md px-2 py-3 text-left text-sm transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none ${
        selected
          ? "bg-accent text-accent-foreground border-l-2 border-l-[var(--color-link)]"
          : "text-muted-foreground hover:bg-accent/50"
      }`}
    >
      <span className="truncate">{project.name}</span>
      {project.hasMalformedState ? (
        // A malformed state.json is an error affordance, not a project-state
        // report — this row stays on WarningBadge rather than switching to
        // the pipeline badge (ProjectHeader's error view is a separate branch).
        <WarningBadge message="Malformed state" />
      ) : KIND_PRESENTATION[project.project_type ?? 'standard'].replacesStateBadge ? (
        <ProjectKindBadge projectType={project.project_type} />
      ) : (
        <PipelineTierBadge state={project.state} label={project.stateLabel} />
      )}
    </button>
  );
}
