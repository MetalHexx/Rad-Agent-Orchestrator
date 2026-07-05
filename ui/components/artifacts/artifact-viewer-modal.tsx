"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, Trash2, FileText, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { copyTextToClipboard } from "@/lib/clipboard";
import { buildDocDeepLink } from "@/lib/deep-link";
import { centerScrollLeft, pageScrollDelta, shouldHijackWheel } from "@/lib/filmstrip-scroll";
import { IframePreview } from "./iframe-preview";
import { ActivePulse } from "./active-pulse";
import { BufferedStage } from "./buffered-stage";
import { ChangeBadge } from "@/components/badges";
import { cn } from "@/lib/utils";
import { ModalShell } from "@/components/modal/modal-shell";
import type { ModalDoc } from "@/lib/modal-doc-model";
import type { DocumentFrontmatter } from "@/types/components";

// Only one instance of the modal is ever mounted at a time, so a fixed id is
// safe for aria-labelledby.
const TITLE_ID = "artifact-viewer-modal-title";

export interface ArtifactViewerModalProps {
  projectName: string;
  artifacts: ModalDoc[];
  /** Identity of the open document — anchored to its path, not an array
   *  index, so focus stays pinned across live reorders/inserts/deletes. A
   *  root doc's path is its bare filename; a subfolder doc's path is its full
   *  project-relative path. */
  activePath: string | null;
  /** Fetched BRAINSTORMING.md body when the active (or any) md cell needs it. */
  markdownContent: string | null;
  /** Which path `markdownContent` belongs to — lets the stage withhold a stale
   *  body from a freshly-navigated md layer until its own fetch resolves (BUG 1). */
  markdownContentFileName?: string | null;
  /** The active markdown doc's frontmatter — gated to `markdownContentFileName`
   *  the same way `markdownContent` is (BUG-1-style stale-doc guard). */
  frontmatter?: DocumentFrontmatter | null;
  /** Whether the frontmatter card is currently toggled on. Default false (hidden). */
  showFrontmatter?: boolean;
  /** Toggles frontmatter visibility. Omitted → the header toggle button is not rendered. */
  onToggleFrontmatter?: () => void;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSelect: (path: string) => void;
  onRequestDelete: () => void;
  isFullScreen: boolean;
  onToggleFullScreen: () => void;
  unseen?: Set<string>;
  activePulse?: Set<string>;
  /** Per-file live mtimes from the store; drives the open HTML doc's in-place
   *  reload off a monotonic signal so repeated changes still bust the cache (BUG 2). */
  mtimes?: Record<string, number>;
  /** Drives the enter/exit animation. "open" plays the entrance; "closed" plays
   *  the exit (the parent keeps the modal mounted for the exit's duration). */
  dataState?: "open" | "closed";
}

export function ArtifactViewerModal({
  projectName, artifacts, activePath, markdownContent, markdownContentFileName,
  frontmatter, showFrontmatter = false, onToggleFrontmatter,
  onClose, onPrev, onNext, onSelect, onRequestDelete, isFullScreen, onToggleFullScreen,
  unseen, activePulse, mtimes, dataState = "open",
}: ArtifactViewerModalProps) {
  const active = artifacts.find((a) => a.path === activePath);

  const [shareState, setShareState] = React.useState<'idle' | 'copied' | 'failed'>('idle');
  const shareTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleShare = React.useCallback(async () => {
    if (!activePath) return;
    const url = buildDocDeepLink(window.location.origin, projectName, activePath);
    const ok = await copyTextToClipboard(url);
    setShareState(ok ? 'copied' : 'failed');
    if (shareTimerRef.current) clearTimeout(shareTimerRef.current);
    shareTimerRef.current = setTimeout(() => setShareState('idle'), 2000);
  }, [projectName, activePath]);
  React.useEffect(() => () => {
    if (shareTimerRef.current) clearTimeout(shareTimerRef.current);
  }, []);

  const stripRef = React.useRef<HTMLDivElement | null>(null);
  const activeCellRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const c = stripRef.current, cell = activeCellRef.current;
    if (!c || !cell) return;
    c.scrollLeft = centerScrollLeft(c.clientWidth, cell.offsetLeft, cell.clientWidth);
    // Roving tabindex means the newly-active cell is the only tab stop; follow
    // focus onto it so the keyboard user isn't stranded on the now-inert
    // previous cell. Only when focus is already inside the filmstrip — never
    // steal focus from the markdown body a reader is scrolling.
    if (c.contains(document.activeElement)) {
      cell.focus();
    }
  }, [activePath]);

  React.useEffect(() => {
    const c = stripRef.current;
    if (!c) return;
    const onWheel = (e: WheelEvent) => {
      if (!shouldHijackWheel(e.deltaX, e.deltaY, c.scrollWidth, c.clientWidth)) return;
      e.preventDefault();
      c.scrollLeft += e.deltaY;
    };
    c.addEventListener('wheel', onWheel, { passive: false });
    return () => c.removeEventListener('wheel', onWheel);
  }, []);

  if (!active) return null;
  const friendly = active.title;

  return (
    <ModalShell
      ariaLabel={`${friendly} — ${active.path}`}
      titleId={TITLE_ID}
      announcement={friendly}
      title={
        <>
          <span id={TITLE_ID} className="text-sm font-medium text-foreground">{friendly}</span>
          <span title={active.path} className="truncate text-xs text-muted-foreground">{active.path}</span>
        </>
      }
      headerActions={
        active.isMarkdown && onToggleFrontmatter ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label={showFrontmatter ? "Hide frontmatter" : "Show frontmatter"}
            className="cursor-pointer"
            onClick={onToggleFrontmatter}
          >
            <Info className="size-4" aria-hidden="true" />
          </Button>
        ) : undefined
      }
      onClose={onClose}
      onPrev={onPrev}
      onNext={onNext}
      onShare={handleShare}
      isFullScreen={isFullScreen}
      onToggleFullScreen={onToggleFullScreen}
      dataState={dataState}
      footer={
        <footer className="relative border-t border-border px-4 py-3">
          <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-12 bg-gradient-to-r from-card to-transparent" aria-hidden="true" />
          <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-12 bg-gradient-to-l from-card to-transparent" aria-hidden="true" />
          <Button variant="ghost" size="icon-sm" aria-label="Scroll filmstrip left"
            className="absolute left-1 top-1/2 z-20 -translate-y-1/2 cursor-pointer"
            onClick={() => { const c = stripRef.current; if (c) c.scrollBy({ left: -pageScrollDelta(c.clientWidth) }); }}>
            <ChevronLeft className="size-4" aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Scroll filmstrip right"
            className="absolute right-1 top-1/2 z-20 -translate-y-1/2 cursor-pointer"
            onClick={() => { const c = stripRef.current; if (c) c.scrollBy({ left: pageScrollDelta(c.clientWidth) }); }}>
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>
          <div ref={stripRef as React.RefObject<HTMLDivElement>} role="tablist" aria-label="Artifacts" className="flex items-end gap-2 overflow-x-auto px-8">
          {artifacts.map((artifact) => {
            const pulsing = activePulse?.has(artifact.path) ?? false;
            const isActive = artifact.path === activePath;
            return (
            <ActivePulse key={artifact.path} active={pulsing} variant="frame" className="rounded-md">
            <div
              data-filmstrip-cell
              ref={isActive ? activeCellRef : undefined}
              role="tab"
              tabIndex={isActive ? 0 : -1}
              aria-label={`View ${artifact.title}`}
              aria-selected={isActive}
              onClick={() => onSelect(artifact.path)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(artifact.path); } }}
              className={cn(
                "flex h-16 w-24 shrink-0 cursor-pointer flex-col items-center overflow-hidden rounded-md border",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                // Grey neutral ring marks the SELECTED doc; while it's being written the
                // ActivePulse lavender glow takes over (supersedes grey), so drop the grey then.
                !pulsing && isActive
                  ? "border-2 ring-2 ring-ring border-ring"
                  : "border-border",
              )}
            >
              <div className="relative h-10 w-full shrink-0 overflow-hidden bg-background">
                {artifact.isMarkdown ? (
                  <div className="flex h-full w-full items-center justify-center bg-muted">
                    <FileText className="size-5 text-muted-foreground" aria-hidden="true" />
                  </div>
                ) : (
                  <IframePreview
                    projectName={projectName}
                    fileName={artifact.path}
                    scale={0.12}
                    interactive={false}
                    eager
                    className="h-full w-full"
                  />
                )}
                {(unseen?.has(artifact.path) ?? false) && (
                  <div className="absolute left-1 top-1 z-10">
                    <ChangeBadge />
                  </div>
                )}
              </div>
              <div className="flex w-full flex-1 items-center justify-center px-1">
                <span className="w-full truncate text-center text-[9px] leading-tight text-muted-foreground">
                  {artifact.title}
                </span>
              </div>
            </div>
            </ActivePulse>
            );
          })}
          </div>
        </footer>
      }
    >
      <div className="relative h-full w-full bg-muted">
        <BufferedStage
          projectName={projectName}
          artifact={active}
          markdownContent={markdownContent}
          markdownContentFileName={markdownContentFileName ?? undefined}
          frontmatter={frontmatter ?? null}
          showFrontmatter={showFrontmatter}
          activePulse={activePulse?.has(active.path) ?? false}
          liveMtime={mtimes?.[active.path] ?? 0}
        />
        <div
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-0",
            (activePulse?.has(active.path) ?? false) && "live-pulse-stage",
          )}
        />
        <button type="button" aria-label="Previous artifact" onClick={onPrev}
          className="absolute left-2 top-1/2 -translate-y-1/2 cursor-pointer rounded-full bg-background/70 p-2 text-foreground hover:bg-background">
          <ChevronLeft className="size-5" aria-hidden="true" />
        </button>
        <button type="button" aria-label="Next artifact" onClick={onNext}
          className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer rounded-full bg-background/70 p-2 text-foreground hover:bg-background">
          <ChevronRight className="size-5" aria-hidden="true" />
        </button>
        <button type="button" aria-label="Delete artifact" onClick={onRequestDelete}
          className="absolute bottom-3 right-3 z-10 cursor-pointer rounded-full bg-background/70 p-2 text-muted-foreground hover:bg-background hover:text-destructive">
          <Trash2 className="size-5" aria-hidden="true" />
        </button>
        {shareState !== 'idle' && (
          <div role="status" aria-live="polite"
            className="absolute right-4 top-12 z-10 rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md">
            {shareState === 'copied' ? 'Link copied' : 'Copy failed'}
          </div>
        )}
      </div>
    </ModalShell>
  );
}
