'use client';

import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { FileText, GitPullRequest } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface CardControlsRowProps {
  children?: ReactNode;
  className?: string;
}

/**
 * The single controls container every dag-widget card view uses: lays its
 * children out horizontally and wraps onto additional lines on narrow
 * widths, so a card carrying several controls (doc buttons, commit chip, PR
 * link, approve button) never overflows the card's fixed width.
 */
export function CardControlsRow({ children, className }: CardControlsRowProps) {
  return <div className={cn('flex flex-wrap items-center gap-2', className)}>{children}</div>;
}

export interface DocButtonProps {
  /** Document path relative to the project dir, or null if the document doesn't exist yet. */
  path: string | null;
  /** Visible button label (e.g., "Task Handoff", "Code Review", "Report"). */
  label: string;
  /** Fires with the resolved path on click. Never called while `path` is null. */
  onDocClick: (path: string) => void;
  /**
   * CSS custom property (e.g. `--tier-execution`) tinting the leading icon,
   * set directly on the icon. Omit to inherit the button's own foreground
   * color. Unlike `DocumentLink`, this button's icon isn't styled
   * `text-primary`, so `tierTintStyle`'s `--primary` override has nothing to
   * retint — the color is set on the icon itself instead.
   */
  iconCssVar?: string;
  /** House Button visual weight. Defaults to "outline". */
  variant?: 'outline' | 'secondary';
  /** House Button size. Defaults to "sm". */
  size?: 'sm' | 'xs';
  /** Leading icon; defaults to the document glyph `DocumentLink` uses. */
  icon?: LucideIcon;
  /**
   * Optional tabIndex override. Defaults to the browser's natural tab order
   * for a focusable button. Mirrors `DocumentLink`'s roving-tabindex escape
   * hatch for callers embedding this inside a roving-tabindex row.
   */
  tabIndex?: number;
}

/**
 * A real, keyboard-reachable button wrapping the house `Button`, standing in
 * for `DocumentLink`'s text-link affordance in the card's controls row while
 * keeping `DocumentLink`'s `onDocClick(path)` contract and null-path
 * handling (renders disabled rather than omitting the control, so the row's
 * layout stays stable regardless of doc availability).
 */
export function DocButton({
  path,
  label,
  onDocClick,
  iconCssVar,
  variant = 'outline',
  size = 'sm',
  icon: Icon = FileText,
  tabIndex,
}: DocButtonProps) {
  const iconStyle = iconCssVar ? { color: `var(${iconCssVar})` } : undefined;

  if (path === null) {
    return (
      <Button variant={variant} size={size} disabled tabIndex={tabIndex} aria-label={label}>
        <Icon style={iconStyle} aria-hidden="true" />
        {label}
      </Button>
    );
  }

  return (
    <Button
      variant={variant}
      size={size}
      tabIndex={tabIndex}
      aria-label={label}
      onClick={() => onDocClick(path)}
    >
      <Icon style={iconStyle} aria-hidden="true" />
      {label}
    </Button>
  );
}

export interface ExternalLinkButtonProps {
  /** Full external URL; opens in a new tab. */
  href: string;
  /** Visible button label (e.g., "PR #164"). */
  label: string;
  /** Leading icon; defaults to the pull-request glyph. */
  icon?: LucideIcon;
  /**
   * CSS custom property (e.g. `--tier-complete`) tinting the leading icon.
   * Omit to inherit the button's own foreground color. Mirrors `DocButton`.
   */
  iconCssVar?: string;
  /** Optional tabIndex override; defaults to the natural tab order. */
  tabIndex?: number;
}

/**
 * The external-link counterpart to `DocButton`: an `<a>` carrying the exact
 * house `Button` outline chrome (via `buttonVariants`) so a card's outbound
 * link (a PR, a commit) reads as the same button as its doc controls, while
 * still being a real anchor that opens in a new tab. Card controls are
 * deliberately uniform — every affordance is an outline+icon button — so this
 * shares `DocButton`'s look rather than the borderless text-link
 * `DocumentLink`/`ExternalLink` used elsewhere.
 */
export function ExternalLinkButton({
  href,
  label,
  icon: Icon = GitPullRequest,
  iconCssVar,
  tabIndex,
}: ExternalLinkButtonProps) {
  const iconStyle = iconCssVar ? { color: `var(${iconCssVar})` } : undefined;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      tabIndex={tabIndex}
      aria-label={label}
      className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
    >
      <Icon style={iconStyle} aria-hidden="true" />
      {label}
    </a>
  );
}
