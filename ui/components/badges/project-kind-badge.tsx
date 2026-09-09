"use client";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { KIND_PRESENTATION } from "@/components/badges/project-kind-presentation";
import type { ProjectKind } from '@/types/components';

interface ProjectKindBadgeProps {
  projectType?: ProjectKind;
}

export const ProjectKindBadge = React.forwardRef<HTMLSpanElement, ProjectKindBadgeProps>(
  function ProjectKindBadge({ projectType }, ref) {
    const presentation = KIND_PRESENTATION[projectType ?? 'standard'];
    if (!presentation.variant) return null;
    const { label, variant, icon: Icon } = presentation;
    return (
      <Badge
        ref={ref}
        variant={variant}
        className="gap-1.5"
        aria-label={`Project kind: ${label}`}
      >
        {Icon && <Icon />}
        {label}
      </Badge>
    );
  },
);
ProjectKindBadge.displayName = "ProjectKindBadge";
