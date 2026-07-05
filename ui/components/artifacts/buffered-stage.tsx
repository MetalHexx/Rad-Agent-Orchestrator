"use client";

import * as React from "react";
import { MarkdownRenderer } from "@/components/documents/markdown-renderer";
import { DocumentMetadata } from "@/components/documents/document-metadata";
import { StageIframe } from "./iframe-preview";
import { ActivePulse } from "./active-pulse";
import {
  initStage,
  beginNavigate,
  markIncomingReady,
  settleStage,
  applyLiveUpdate,
  type SlotIndex,
} from "./stage-transition";
import type { ModalDoc } from "@/lib/modal-doc-model";
import type { DocumentFrontmatter } from "@/types/components";
import { cn } from "@/lib/utils";

/** How long the cross-fade runs before the incoming slot is promoted and the
 *  outgoing buffer is freed. Must match the `duration-300` transition below so
 *  the promotion happens only after the fade has visually completed. A little
 *  slack avoids freeing the outgoing layer one frame early. */
const CROSSFADE_MS = 320;

/** Markdown layer: reports ready via a layout effect once the body is committed
 *  to the DOM — a deterministic signal that does NOT depend on a <div onLoad>,
 *  which never fires for a markdown subtree (DD-7/FR-16). */
export function MarkdownLayer({
  content, frontmatter = null, showFrontmatter = false, scrollRef, onReady,
}: {
  content: string | null;
  /** The doc's frontmatter, gated to this slot's fileName by the caller — null
   *  when absent or when it belongs to a different doc. */
  frontmatter?: DocumentFrontmatter | null;
  /** Whether the frontmatter card should render above the body. */
  showFrontmatter?: boolean;
  scrollRef: React.RefObject<HTMLDivElement>;
  onReady?: () => void;
}) {
  React.useLayoutEffect(() => {
    if (content !== null) onReady?.();
  }, [content, onReady]);
  return (
    <div ref={scrollRef} className="h-full overflow-auto bg-background p-6">
      {content !== null ? (
        <div className="space-y-4">
          {showFrontmatter && frontmatter && <DocumentMetadata frontmatter={frontmatter} />}
          <MarkdownRenderer content={content} />
        </div>
      ) : (
        <div role="status" aria-label="Loading document" className="flex h-full items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary" />
        </div>
      )}
    </div>
  );
}

export function BufferedStage({
  projectName, artifact, markdownContent, markdownContentFileName, activePulse, liveMtime = 0,
  frontmatter = null, showFrontmatter = false,
}: {
  projectName: string;
  /** The active document — identified by `path`, which is the raw/document API's `?path=` value. */
  artifact: ModalDoc;
  markdownContent: string | null;
  /** Which file `markdownContent` actually belongs to. When provided, a markdown
   *  slot only renders the body if its own fileName matches — preventing a stale
   *  flash of the previous doc on md→md navigation before the new fetch resolves
   *  (BUG 1). Omit (undefined) to keep the legacy "content always applies" behavior. */
  markdownContentFileName?: string;
  activePulse: boolean;
  /** Monotonic per-file change signal (the open file's live mtime). Each on-disk
   *  change advances it, even repeats inside the pulse-settle window — which the
   *  pulse rising edge alone misses (BUG 2). */
  liveMtime?: number;
  /** The active document's frontmatter — gated to `markdownContentFileName` the
   *  same way `markdownContent` is, so a stale doc's metadata never flashes over
   *  a freshly-navigated body. */
  frontmatter?: DocumentFrontmatter | null;
  /** Whether the frontmatter card is currently toggled on. */
  showFrontmatter?: boolean;
}) {
  const [stage, setStage] = React.useState(() => initStage(artifact.path));
  // One stable scroll container per physical slot so two markdown bodies can be
  // in flight without sharing a ref.
  const scrollRef0 = React.useRef<HTMLDivElement>(null);
  const scrollRef1 = React.useRef<HTMLDivElement>(null);
  const scrollRefs = [scrollRef0, scrollRef1] as const;
  const [liveRefreshKey, setLiveRefreshKey] = React.useState(0);
  const prevMtimeRef = React.useRef(liveMtime);
  const prevMtimeFileRef = React.useRef(artifact.path);

  // The active artifact changed → load it into the background slot and cross-fade.
  React.useEffect(() => {
    setStage((s) => beginNavigate(s, artifact.path));
  }, [artifact.path]);

  // Once the incoming slot reports ready and the fade starts, promote it after
  // the fade duration. Re-keyed on `incoming` so an interrupted navigation (a new
  // beginNavigate resets crossfading) cancels the stale promotion.
  React.useEffect(() => {
    if (!stage.crossfading) return;
    const t = setTimeout(() => setStage((s) => settleStage(s)), CROSSFADE_MS);
    return () => clearTimeout(t);
  }, [stage.crossfading, stage.incoming]);

  // A live change just landed on the open document — detected via the monotonic
  // per-file mtime advancing (fires for EVERY change, including a repeat inside
  // the pulse-settle window where activePulse never drops, BUG 2). For a same-file
  // update, reload the foreground iframe in place — preserve scroll, no cross-fade
  // (DD-11). Markdown re-renders in place via its content prop without a remount.
  React.useEffect(() => {
    const sameFile = prevMtimeFileRef.current === artifact.path;
    if (sameFile && liveMtime > prevMtimeRef.current) {
      const plan = applyLiveUpdate(stage, artifact.path);
      if (plan.preserveScroll) setLiveRefreshKey((k) => k + 1);
    }
    prevMtimeRef.current = liveMtime;
    prevMtimeFileRef.current = artifact.path;
  }, [liveMtime, stage, artifact.path]);

  const onReady = React.useCallback(() => setStage((s) => markIncomingReady(s)), []);

  // Render one layer per stable physical slot. A slot is keyed by its index, not
  // its file name, so promotion never reorders or remounts it; only the inner
  // renderer remounts when a *new* file is loaded into that slot (StageIframe
  // keys its <iframe> by fileName). Two layers always exist for double-buffering.
  function renderSlot(slotIdx: SlotIndex) {
    const layer = stage.slots[slotIdx];
    const fileName = layer?.fileName ?? null;
    const isFront = slotIdx === stage.front;
    const isIncoming = slotIdx === stage.incoming;
    // The foreground is visible; the incoming becomes visible only while it
    // cross-fades in. An empty/parked slot stays hidden.
    const visible = isFront || (isIncoming && stage.crossfading);
    // The incoming layer must sit above the still-visible foreground as it fades
    // in, so the foreground is never revealed through it mid-fade.
    const zIndex = isIncoming ? 20 : isFront ? 10 : 0;
    // Only the incoming (back) slot reports ready; the foreground is already shown.
    const reportReady = isIncoming ? onReady : undefined;
    // Only apply the shared markdown body to the slot it actually belongs to (BUG 1);
    // when the prop is omitted, fall back to "content always applies". Frontmatter
    // rides the same gate — it was fetched and set alongside the body, so a slot
    // only ever shows metadata for the doc it's currently displaying.
    const isMd = fileName?.endsWith(".md") ?? false;
    const matchesActiveFile = markdownContentFileName === undefined || fileName === markdownContentFileName;
    const layerContent = matchesActiveFile ? markdownContent : null;
    const layerFrontmatter = matchesActiveFile ? frontmatter : null;
    return (
      <div
        key={slotIdx}
        data-stage-layer
        style={{ zIndex }}
        className={cn(
          "absolute inset-0",
          // Only a slot that holds a document animates. A slot freed at settle
          // (fileName === null) snaps to hidden instead of fading out — animating
          // opacity/blur/scale on a just-emptied layer is the post-cross-fade flicker.
          // The incoming slot already has content (and its transition) before it
          // fades in, so the entrance animation is preserved.
          fileName !== null && "transition-all duration-300",
          visible ? "opacity-100 blur-0 scale-100" : "opacity-0 blur-sm scale-[0.98]",
        )}
      >
        {fileName === null ? null : isMd ? (
          <MarkdownLayer
            content={layerContent}
            frontmatter={layerFrontmatter}
            showFrontmatter={showFrontmatter}
            scrollRef={scrollRefs[slotIdx]}
            onReady={reportReady}
          />
        ) : (
          <StageIframe
            projectName={projectName}
            fileName={fileName}
            onLoad={reportReady}
            // Cache-bust is keyed to the live edit count, NOT to front-promotion. The
            // incoming slot renders with the same reloadKey it will keep as front, so
            // settle (front flip) never mutates the src → no reload/flicker when the
            // cross-fade completes. A genuine live edit still bumps liveRefreshKey and
            // reloads the front doc in place (BUG 2). liveRefreshKey starts at 0 (falsy),
            // so there's no `&v=` until a real change lands.
            reloadKey={liveRefreshKey}
          />
        )}
      </div>
    );
  }

  return (
    // `isolate` keeps the per-slot z-index (front=10, incoming=20) a private
    // stacking context so it never paints over the modal's prev/next/delete
    // buttons, which are siblings of this stage in the DOM.
    <ActivePulse active={activePulse} variant="frame" className="absolute inset-0 isolate">
      {/* Dark backstop replaces the white iframe background (DD-8). No onLoad
          here — readiness is reported per layer by each renderer. */}
      <div className="absolute inset-0 bg-background">
        {renderSlot(0)}
        {renderSlot(1)}
      </div>
    </ActivePulse>
  );
}
