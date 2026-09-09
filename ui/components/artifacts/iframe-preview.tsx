"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface IframePreviewProps {
  projectName: string;
  fileName: string;
  /** CSS scale factor for thumbnails/filmstrip; omit for full-size stage. */
  scale?: number;
  /** When false, sets pointer-events:none (thumbnails). Defaults to true. */
  interactive?: boolean;
  /** When true, the iframe loads immediately (loading="eager"). Defaults to false (lazy). */
  eager?: boolean;
  /** Optional title for a11y. */
  title?: string;
  className?: string;
}

export function IframePreview({
  projectName,
  fileName,
  scale,
  interactive = true,
  eager = false,
  title,
  className,
}: IframePreviewProps) {
  const src = `/api/projects/${encodeURIComponent(projectName)}/raw?path=${encodeURIComponent(fileName)}&chrome=hide`;
  const style: React.CSSProperties = {};
  if (scale !== undefined) {
    style.transform = `scale(${scale})`;
    style.transformOrigin = "top left";
    style.width = `${100 / scale}%`;
    style.height = `${100 / scale}%`;
  }
  if (!interactive) {
    style.pointerEvents = "none";
  }
  return (
    <iframe
      src={src}
      title={title ?? fileName}
      // allow-same-origin (without allow-scripts) so the injected scrollbar CSS is
      // honored — an opaque-origin iframe ignores scrollbar styling. Scripts stay
      // disabled, so these static artifacts still can't run JS / read app storage.
      sandbox="allow-same-origin"
      loading={eager ? "eager" : "lazy"}
      referrerPolicy="no-referrer"
      className={cn("border-0 bg-white", className)}
      style={style}
    />
  );
}

export const STAGE_DESIGN_WIDTH = 1280;

/** Scale to fit `containerWidth` to a `designWidth`, never upscaling (≤ 1 keeps text crisp). */
export function computeFitScale(containerWidth: number, designWidth: number): number {
  if (containerWidth <= 0 || designWidth <= 0) return 1;
  if (containerWidth >= designWidth) return 1;
  return containerWidth / designWidth;
}

/** Read this iframe's own scroll offset via the window-level API — correct
 *  regardless of whether the artifact's own CSS scrolls `html` or `body`
 *  (the `?chrome=scroll` injection only styles the scrollbar, it doesn't pin
 *  which element scrolls). Degrades to 0 if the origin is ever unusable. */
export function readIframeScrollTop(el: HTMLIFrameElement | null): number {
  try {
    return el?.contentWindow?.scrollY ?? 0;
  } catch {
    return 0;
  }
}

/** Apply a scroll offset to this iframe's own window. Silent no-op on any
 *  access error — the reader lands at the top, which is today's behavior. */
export function applyIframeScrollTop(el: HTMLIFrameElement | null, top: number): void {
  try {
    el?.contentWindow?.scrollTo(0, top);
  } catch {
    // Origin access failed — leave the reader at the top (today's behavior).
  }
}

export function StageIframe({
  projectName,
  fileName,
  onLoad,
  reloadKey,
  initialScrollTop,
  iframeRef,
}: {
  projectName: string;
  fileName: string;
  onLoad?: () => void;
  reloadKey?: number;
  /** Applied to this iframe's own scroll offset inside its load handler, BEFORE
   *  the caller's onLoad runs — so it lands while the slot is still hidden. */
  initialScrollTop?: number;
  /** Lets the parent read this slot's current scroll offset. */
  iframeRef?: React.RefObject<HTMLIFrameElement | null>;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const localIframeRef = React.useRef<HTMLIFrameElement | null>(null);
  const [size, setSize] = React.useState({ width: 0, height: 0 });
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const base = `/api/projects/${encodeURIComponent(projectName)}/raw?path=${encodeURIComponent(fileName)}&chrome=scroll`;
  const src = reloadKey ? `${base}&v=${reloadKey}` : base;
  const measured = size.width > 0 && size.height > 0;
  const scale = measured ? computeFitScale(size.width, STAGE_DESIGN_WIDTH) : 1;
  // viewport dims chosen so displayed size === measured container size exactly (no blank band):
  const style: React.CSSProperties = measured
    ? {
        width: `${size.width / scale}px`,
        height: `${size.height / scale}px`,
        transform: `scale(${scale})`,
        transformOrigin: "top left",
      }
    : { width: "100%", height: "100%" };
  const setIframeEl = (el: HTMLIFrameElement | null) => {
    localIframeRef.current = el;
    if (iframeRef) (iframeRef as React.MutableRefObject<HTMLIFrameElement | null>).current = el;
  };
  const handleLoad = () => {
    if (initialScrollTop !== undefined) applyIframeScrollTop(localIframeRef.current, initialScrollTop);
    onLoad?.();
  };
  return (
    <div ref={containerRef} className="h-full w-full overflow-hidden">
      <iframe
        key={fileName}
        ref={setIframeEl}
        src={src}
        title={fileName}
        // allow-same-origin (without allow-scripts) so the injected scrollbar CSS is
        // honored — an opaque-origin iframe ignores scrollbar styling. Scripts stay
        // disabled, so these static artifacts still can't run JS / read app storage.
        sandbox="allow-same-origin"
        loading="eager"
        referrerPolicy="no-referrer"
        // Dark backstop color, not white, so the first open (when the front
        // iframe loads visibly) never flashes white before content paints (DD-8).
        className="border-0 bg-background"
        style={style}
        onLoad={handleLoad}
      />
    </div>
  );
}
