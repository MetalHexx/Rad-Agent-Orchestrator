"use client";
import * as React from "react";
import { Maximize2, X, Share2 } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { modalKeyAction } from "@/hooks/use-artifact-modal";

// Elements the Tab trap and initial-focus effect treat as tab stops. Mirrors
// the roving-tabindex convention used by the filmstrip: only tabindex="0"
// elements count, so an inactive filmstrip cell (tabindex="-1") is skipped.
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface ModalShellProps {
  ariaLabel: string;
  /** Id of the visible title element; when present, drives `aria-labelledby`
   *  on the dialog (preferred over `ariaLabel`, which remains the fallback). */
  titleId?: string;
  title: React.ReactNode;            // slot
  headerActions?: React.ReactNode;   // slot: caller extras before built-ins
  footer?: React.ReactNode;          // slot
  children: React.ReactNode;         // body slot (scroll container)
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onShare?: () => void;              // built-in Share rendered only when provided
  isFullScreen: boolean;
  onToggleFullScreen: () => void;
  dataState?: "open" | "closed";
  /** Text for the visually-hidden live region, announced to screen readers
   *  whenever it changes (e.g. the active document's title on prev/next/select). */
  announcement?: string;
}

export function ModalShell({
  ariaLabel, titleId, title, headerActions, footer, children,
  onClose, onPrev, onNext, onShare, isFullScreen, onToggleFullScreen, dataState = "open",
  announcement,
}: ModalShellProps) {
  const panelRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const action = modalKeyAction(e.key);
      if (action === null) return;
      e.preventDefault();
      if (action === 'prev') onPrev?.();
      else if (action === 'next') onNext?.();
      else if (action === 'close') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onPrev, onNext, onClose]);

  // Initial focus + focus restore: move focus into the panel as soon as it
  // mounts, and hand it back to whatever had focus before the modal opened.
  // The parent keeps the modal mounted for the ~200ms exit animation before
  // actually unmounting it (dataState="closed" plays the animation; the
  // unmount itself happens later), so this cleanup — which only runs on
  // unmount — naturally restores focus after the animation, not mid-flight.
  React.useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => {
      if (previouslyFocused && previouslyFocused.isConnected) previouslyFocused.focus();
    };
  }, []);

  // Focus trap: keep Tab/Shift+Tab cycling within the panel's own focusable
  // elements instead of escaping to the page behind the modal. Minimal
  // keydown-cycling implementation — no dialog library, no `inert` toggling.
  const handleTrapKeyDown = React.useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    if (focusable.length === 0) {
      e.preventDefault();
      panel.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (e.shiftKey) {
      if (active === first || !panel.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else if (active === last || !panel.contains(active)) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  // Lock background scroll while the modal is open so the page behind it
  // cannot scroll and we don't get a second (page-level) scrollbar alongside
  // the modal's own. Compensate for the removed scrollbar width to avoid a
  // layout shift when it disappears. Restores the prior values on close.
  React.useEffect(() => {
    const { body, documentElement } = document;
    const prevOverflow = body.style.overflow;
    const prevPaddingRight = body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - documentElement.clientWidth;
    body.style.overflow = "hidden";
    if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`;
    return () => {
      body.style.overflow = prevOverflow;
      body.style.paddingRight = prevPaddingRight;
    };
  }, []);

  return (
    <div role="dialog" aria-modal="true" aria-labelledby={titleId} aria-label={titleId ? undefined : ariaLabel} data-state={dataState}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 supports-backdrop-filter:backdrop-blur-sm artifact-modal-overlay duration-200 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={panelRef} tabIndex={-1} onKeyDown={handleTrapKeyDown} data-state={dataState}
        className={cn(
          "fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col overflow-hidden bg-card text-card-foreground ring-1 ring-foreground/10 shadow-lg artifact-modal-panel transition-[width,height,max-width,border-radius] duration-200 ease-out outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          isFullScreen ? "h-screen w-screen max-w-[100vw] rounded-none" : "h-[85vh] w-[90vw] max-w-5xl rounded-xl")}>
        <div role="status" aria-live="polite" className="sr-only">{announcement}</div>
        <header className="flex items-center gap-2 border-b border-border px-4 py-3">
          {title}
          <div className="ml-auto flex items-center gap-1">
            {headerActions}
            <TooltipProvider>
              {onShare && (
                <Tooltip>
                  {/* A native <button> instead of the shared Button component: Button isn't
                      wrapped in React.forwardRef, so TooltipTrigger's ref never reaches the
                      real DOM node and the tooltip fails to close on blur (confirmed live —
                      it stays open after Tab moves focus away). buttonVariants gives the same
                      styling on a host element, which always accepts refs. */}
                  <TooltipTrigger render={
                    <button type="button" aria-label="Share / copy link" onClick={onShare}
                      className={buttonVariants({ variant: "ghost", size: "icon", className: "cursor-pointer" })}>
                      <Share2 className="size-4" aria-hidden="true" />
                    </button>
                  } />
                  <TooltipContent>Copy a shareable link to this document</TooltipContent>
                </Tooltip>
              )}
              <Tooltip>
                <TooltipTrigger render={
                  <button type="button" aria-label={isFullScreen ? "Exit full screen" : "Full screen"} onClick={onToggleFullScreen}
                    className={buttonVariants({ variant: "ghost", size: "icon", className: "cursor-pointer" })}>
                    <Maximize2 className="size-4" aria-hidden="true" />
                  </button>
                } />
                <TooltipContent>{isFullScreen ? "Exit full screen" : "Enter full screen"}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger render={
                  <button type="button" aria-label="Close" onClick={onClose}
                    className={buttonVariants({ variant: "ghost", size: "icon", className: "cursor-pointer" })}>
                    <X className="size-4" aria-hidden="true" />
                  </button>
                } />
                <TooltipContent>Close</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </header>
        <div className="relative flex-1 overflow-hidden">{children}</div>
        {footer}
      </div>
    </div>
  );
}
