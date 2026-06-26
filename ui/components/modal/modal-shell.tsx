"use client";
import * as React from "react";
import { Maximize2, X, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { modalKeyAction } from "@/hooks/use-artifact-modal";

export interface ModalShellProps {
  ariaLabel: string;
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
}

export function ModalShell({
  ariaLabel, title, headerActions, footer, children,
  onClose, onPrev, onNext, onShare, isFullScreen, onToggleFullScreen, dataState = "open",
}: ModalShellProps) {
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
    <div role="dialog" aria-modal="true" aria-label={ariaLabel} data-state={dataState}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 supports-backdrop-filter:backdrop-blur-sm artifact-modal-overlay duration-200 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div data-state={dataState}
        className={cn(
          "fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col overflow-hidden bg-card text-card-foreground ring-1 ring-foreground/10 shadow-lg artifact-modal-panel transition-[width,height,max-width,border-radius] duration-200 ease-out data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          isFullScreen ? "h-screen w-screen max-w-[100vw] rounded-none" : "h-[85vh] w-[90vw] max-w-5xl rounded-xl")}>
        <header className="flex items-center gap-2 border-b border-border px-4 py-3">
          {title}
          <div className="ml-auto flex items-center gap-1">
            {headerActions}
            {onShare && (
              <Button variant="ghost" size="icon" aria-label="Share / copy link" className="cursor-pointer" onClick={onShare}>
                <Share2 className="size-4" aria-hidden="true" />
              </Button>
            )}
            <Button variant="ghost" size="icon" aria-label="Full screen" className="cursor-pointer" onClick={onToggleFullScreen}>
              <Maximize2 className="size-4" aria-hidden="true" />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Close" className="cursor-pointer" onClick={onClose}>
              <X className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </header>
        <div className="relative flex-1 overflow-hidden">{children}</div>
        {footer}
      </div>
    </div>
  );
}
