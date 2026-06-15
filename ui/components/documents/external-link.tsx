"use client";

import { ExternalLink as ExternalLinkIcon, Github, GitPullRequest } from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ExternalLinkProps {
  /** Full URL to navigate to. When null, renders a visible disabled state
   *  (greyed-out span with tooltip) instead of removing the element from the DOM. */
  href: string | null;
  /** Visible and/or accessible label text */
  label: string;
  /** Icon variant; defaults to "external-link" */
  icon?: 'github' | 'external-link' | 'git-pull-request';
  /** Optional tabIndex override. When set, overrides the default browser tab
   *  order for the underlying <a>. DAG-timeline call sites pass -1 to keep the
   *  listbox's roving-tabindex scheme intact; other call sites omit it so the
   *  link stays in the natural Tab order. */
  tabIndex?: number;
  /** Optional native tooltip text — passed to the underlying <a>'s `title`
   *  attribute. Used by the dag-timeline commit link to expose the full
   *  commit hash on hover (DD-8). The accessible name remains `label` so
   *  screen readers announce descriptive context (e.g. "Commit") rather
   *  than the raw hash. */
  title?: string;
}

export function ExternalLink({
  href,
  label,
  icon = 'external-link',
  tabIndex,
  title,
}: ExternalLinkProps): JSX.Element {
  const Icon = icon === 'github' ? Github : icon === 'git-pull-request' ? GitPullRequest : ExternalLinkIcon;

  if (href === null) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                className="inline-flex items-center gap-1.5 text-muted-foreground cursor-not-allowed"
                aria-disabled="true"
              />
            }
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="sr-only sm:not-sr-only">{label}</span>
          </TooltipTrigger>
          <TooltipContent>Not available</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      tabIndex={tabIndex}
      title={title}
      className="inline-flex items-center gap-1.5 text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm text-sm"
      aria-label={label}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      <span className="sr-only sm:not-sr-only">{label}</span>
    </a>
  );
}
