import type { LucideIcon } from 'lucide-react';
import { Boxes, FolderGit2 } from 'lucide-react';
import type { ProjectKind } from '@rad-orchestration/work-graph';

export interface KindPresentation {
  /** The user-visible word, or null when this kind shows no badge at all. */
  label: string | null;
  variant: 'kindPortfolio' | 'kindSideProject' | null;
  icon: LucideIcon | null;
  /** True when this kind's badge REPLACES the pipeline state badge rather than
   *  sitting beside it — a project with no pipeline has no state to report. */
  replacesStateBadge: boolean;
}

export const KIND_PRESENTATION: Record<ProjectKind, KindPresentation> = {
  standard: { label: null, variant: null, icon: null, replacesStateBadge: false },
  'side-project': {
    label: 'Side Project',
    variant: 'kindSideProject',
    icon: FolderGit2,
    replacesStateBadge: false,
  },
  portfolio: {
    label: 'Portfolio',
    variant: 'kindPortfolio',
    icon: Boxes,
    replacesStateBadge: true,
  },
};
