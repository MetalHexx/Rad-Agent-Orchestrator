"use client";

import * as React from "react";
import { MarkdownRenderer } from "@/components/documents/markdown-renderer";
import { DocumentMetadata } from "@/components/documents/document-metadata";
import { StageIframe, readIframeScrollTop } from "./iframe-preview";
import { ActivePulse } from "./active-pulse";
import {
  initStage,
  beginNavigate,
  beginLiveReload,
  markIncomingReady,
  settleStage,
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

/** How long a same-file live reload waits before promoting the background
 *  slot. Short, because the doc never actually changed identity — this is a
 *  swap, not a navigation, and must not read as one. Must match the
 *  `duration-[120ms]` class `renderSlot` applies while `stage.mode === 'live'`. */
const LIVE_SWAP_MS = 120;

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
  // One stable iframe ref per physical slot so a live reload can read the
  // outgoing (front) slot's scroll offset before handing it to the incoming slot.
  const iframeRef0 = React.useRef<HTMLIFrameElement>(null);
  const iframeRef1 = React.useRef<HTMLIFrameElement>(null);
  const iframeRefs = [iframeRef0, iframeRef1] as const;
  // Per-slot stashed scroll offset for the slot's next live-reload load. Read
  // only while `stage.mode === 'live'` (renderSlot), so a later ordinary
  // navigation into the same physical slot never inherits a stale offset.
  const pendingScrollTopRef = React.useRef<[number | null, number | null]>([null, null]);
  const prevMtimeRef = React.useRef(liveMtime);
  const prevMtimeFileRef = React.useRef(artifact.path);

  // The active artifact changed → load it into the background slot and cross-fade.
  React.useEffect(() => {
    setStage((s) => beginNavigate(s, artifact.path));
  }, [artifact.path]);

  // Once the incoming slot reports ready and the fade starts, promote it after
  // the fade duration — shorter for a live reload (LIVE_SWAP_MS) than a full
  // navigation cross-fade (CROSSFADE_MS), so a same-doc reload doesn't read as
  // a navigation. Re-keyed on `incoming` so an interrupted navigation (a new
  // beginNavigate resets crossfading) cancels the stale promotion.
  React.useEffect(() => {
    if (!stage.crossfading) return;
    const duration = stage.mode === 'live' ? LIVE_SWAP_MS : CROSSFADE_MS;
    const t = setTimeout(() => setStage((s) => settleStage(s)), duration);
    return () => clearTimeout(t);
  }, [stage.crossfading, stage.incoming, stage.mode]);

  // A live change just landed on the open document — detected via the monotonic
  // per-file mtime advancing (fires for EVERY change, including a repeat inside
  // the pulse-settle window where activePulse never drops, BUG 2). Markdown
  // re-renders in place via its content prop without a remount, so it needs no
  // action here. HTML captures the front iframe's current scroll offset, stashes
  // it for the incoming (background) slot, and reloads that slot at the next
  // generation — the foreground iframe's src never changes, so its scroll is
  // never disturbed (FR-1, DD-11).
  React.useEffect(() => {
    const sameFile = prevMtimeFileRef.current === artifact.path;
    if (!sameFile) {
      // A different doc holds the stage now — re-baseline to its own mtime; there is
      // no pending change to apply for a doc that was just opened.
      prevMtimeRef.current = liveMtime;
    } else if (liveMtime > prevMtimeRef.current && !artifact.isMarkdown) {
      const bg = stage.front === 0 ? 1 : 0;
      // Derive from whichever slot currently holds the freshest known generation
      // of this doc: the incoming slot when a prior live reload is still in
      // flight (its reloadKey is the latest one issued), otherwise the front
      // layer. Deriving from the front layer alone would replay the SAME
      // generation for a second edit landing before the first one settles —
      // breaking the monotonic cache-bust a repeat inside the pulse-settle
      // window relies on (BUG 2).
      const currentLayer = stage.incoming !== null ? stage.slots[bg] : stage.slots[stage.front];
      const nextGen = (currentLayer?.reloadKey ?? 0) + 1;
      const next = beginLiveReload(stage, artifact.path, nextGen);
      // Only an ACCEPTED reload consumes this mtime. beginLiveReload no-ops while
      // this file is still the *incoming*, not-yet-settled slot; advancing
      // prevMtimeRef there would swallow the edit — this effect re-runs when the
      // navigation settles `stage`, and the same mtime must still read as new for
      // the reload to be retried against the now-settled front, or the doc sits on
      // pre-edit content until some later edit happens to land.
      if (next !== stage) {
        pendingScrollTopRef.current[bg] = readIframeScrollTop(iframeRefs[stage.front].current);
        // Functional form, not a bare `setStage(next)`: `next` was derived from the
        // `stage` this effect closed over. Guarding `s === stage` means a state
        // update from another effect landing in the same commit can never be
        // clobbered by a `next` computed against an already-stale snapshot.
        setStage((s) => (s === stage ? next : s));
        prevMtimeRef.current = liveMtime;
      }
    }
    prevMtimeFileRef.current = artifact.path;
  }, [liveMtime, stage, artifact.path, artifact.isMarkdown]);

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
    // A live reload swaps on a shorter timer than a navigation cross-fade
    // (LIVE_SWAP_MS vs CROSSFADE_MS) — the transition duration class must match
    // whichever timer is driving the current swap, or settle frees the outgoing
    // layer mid-fade.
    const durationClass = stage.mode === "live" ? "duration-[120ms]" : "duration-300";
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
          fileName !== null && `transition-all ${durationClass}`,
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
            // Cache-bust is per-layer (layer.reloadKey), NOT a shared counter —
            // reloading the background slot for a live edit must never change the
            // still-visible foreground slot's src (the seam this task exists for).
            // The incoming slot renders with the same reloadKey it will keep as
            // front, so settle (front flip) never mutates the src → no reload/
            // flicker when the swap completes. reloadKey is undefined until a real
            // change lands, so there's no `&v=` until then.
            reloadKey={layer?.reloadKey}
            // Only ever meaningful for the incoming slot of an in-flight live
            // reload — an ordinary navigation's incoming slot must land at the
            // top, not inherit a stale offset stashed by a past live reload.
            initialScrollTop={isIncoming && stage.mode === "live" ? pendingScrollTopRef.current[slotIdx] ?? undefined : undefined}
            iframeRef={iframeRefs[slotIdx]}
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
