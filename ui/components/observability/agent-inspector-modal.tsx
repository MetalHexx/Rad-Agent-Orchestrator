"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { ModalShell } from "@/components/modal/modal-shell";
import { FacetTabs } from "./facet-tabs";
import { AgentNavigatorStrip } from "./agent-navigator-strip";
import { RawTranscriptView } from "./raw-transcript-view";
import { useAgentInspector, useSessionAgents } from "@/hooks/use-agent-inspector";

// ---------------------------------------------------------------------------
// AgentInspectorModal — composes the full Agent Inspector overlay (FR-6, FR-9,
// FR-13, FR-14, FR-15, DD-1, DD-2, DD-3, DD-5, DD-6, DD-7, NFR-5, NFR-6)
//
// Layout (DD-1):
//   header = AgentIdentityHeader (one-line: bold label + muted descriptor, DD-2)
//   body   = FacetTabs + active panel (RawTranscriptView | empty state) + content-edge nav chevrons (FR-15)
//   footer = AgentNavigatorStrip (DD-1)
//
// Driven by useSessionAgents + useAgentInspector hooks.
// No onShare wired — deferred in 5.3 (AD-1).
// Content components receive props only (NFR-6).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// AgentIdentityHeader — one line: bold label + muted descriptor (DD-2)
// Both spans are direct children of ModalShell's `flex items-center gap-2`
// header, so they lay out inline like the artifact viewer's title (item 3).
// ---------------------------------------------------------------------------

interface AgentIdentityHeaderProps {
  label: string;
  agentType?: string;
  role?: string;
  model?: string;
}

function AgentIdentityHeader({ label, agentType, role, model }: AgentIdentityHeaderProps) {
  const parts = [agentType, role, model].filter(Boolean);
  const descriptor = parts.length > 0 ? parts.join(' · ') : null;
  return (
    <>
      <span className="truncate text-sm font-medium text-foreground">{label}</span>
      {descriptor && (
        <span className="truncate text-xs text-muted-foreground">{descriptor}</span>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// AgentInspectorModal
// ---------------------------------------------------------------------------

export interface AgentInspectorModalProps {
  sessionId: string;
  agentId: string | null;
  /** transcriptId → display label from the breakdown table (authoritative numbering,
   *  e.g. 'coder 1', 'Main Agent'). Keeps the modal's title + chips in lockstep with the table. */
  labels?: Map<string, string>;
  /** Call when the user changes the active agent (chip or prev/next). */
  onSelectAgent: (transcriptId: string) => void;
  onClose: () => void;
  isFullScreen: boolean;
  onToggleFullScreen: () => void;
  dataState?: "open" | "closed";
}

export function AgentInspectorModal({
  sessionId, agentId, labels, onSelectAgent, onClose, isFullScreen, onToggleFullScreen, dataState = "open",
}: AgentInspectorModalProps) {
  const { navList } = useSessionAgents(sessionId);
  const { transcript, justUpdated, activeFacet, setActiveFacet, prevId, nextId } = useAgentInspector(
    sessionId, agentId, navList,
  );

  const activeAgent = navList.find((a) => a.transcriptId === agentId);

  // Keyboard ← / → navigation handled by ModalShell (FR-15, DD-6)
  const handlePrev = React.useCallback(() => {
    if (prevId) onSelectAgent(prevId);
  }, [prevId, onSelectAgent]);

  const handleNext = React.useCallback(() => {
    if (nextId) onSelectAgent(nextId);
  }, [nextId, onSelectAgent]);

  // Agent identity header slot (DD-2). Label comes from the table's authoritative
  // numbering when available, so the title reads 'Main Agent' / 'coder 1'.
  const titleSlot = (
    <AgentIdentityHeader
      label={labels?.get(agentId ?? '') ?? activeAgent?.label ?? 'Agent'}
      agentType={activeAgent?.agentType}
      role={activeAgent?.role}
      model={activeAgent?.model}
    />
  );

  // Footer: agent navigator strip (DD-1). Chips carry the table's mapped labels;
  // order stays chronological from navList. Main chip resolves to 'Main Agent'.
  const chips = navList.map((a) => ({ ...a, label: labels?.get(a.transcriptId) ?? a.label }));
  const footer = (
    <AgentNavigatorStrip
      agents={chips}
      activeId={agentId}
      onSelect={onSelectAgent}
    />
  );

  return (
    <ModalShell
      ariaLabel="Agent Inspector"
      title={titleSlot}
      footer={footer}
      onClose={onClose}
      onPrev={prevId ? handlePrev : undefined}
      onNext={nextId ? handleNext : undefined}
      isFullScreen={isFullScreen}
      onToggleFullScreen={onToggleFullScreen}
      dataState={dataState}
    >
      {/* Body: facet tab bar + active panel (FR-13, FR-15) */}
      <div className="flex h-full flex-col overflow-hidden">
        {/* Facet tab bar — Raw active; four future facets disabled "soon" (FR-13, DD-3) */}
        <FacetTabs active={activeFacet === 'raw' ? 'raw' : 'raw'} onSelect={(f) => setActiveFacet(f === 'raw' ? 'raw' : 'raw')} />

        {/* Active panel */}
        <div className="min-h-0 flex-1 overflow-hidden">
          {transcript != null ? (
            /* Raw transcript view — shown when transcript is present (FR-9) */
            activeFacet === 'raw' ? (
              <RawTranscriptView
                transcript={transcript}
                file={agentId ?? 'transcript'}
                justUpdated={justUpdated}
              />
            ) : (
              /* Future facets — not yet implemented */
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                This view is coming soon.
              </div>
            )
          ) : (
            /* Empty state — no transcript for this agent (FR-9) */
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <span className="text-sm font-medium text-foreground">No transcript for this agent</span>
              <span className="text-xs text-muted-foreground">
                The agent may still be running or its transcript is unavailable.
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Content-edge nav chevrons (FR-15) — overlay the body's relative container,
          mirroring the artifact viewer; ends disable. Keyboard ←/→ stays via ModalShell. */}
      <button type="button" aria-label="Previous agent" onClick={handlePrev} disabled={!prevId}
        className={cn(
          "absolute left-2 top-1/2 z-10 -translate-y-1/2 cursor-pointer rounded-full bg-background/70 p-2 text-foreground hover:bg-background",
          !prevId && "pointer-events-none opacity-40",
        )}>
        <ChevronLeft className="size-5" aria-hidden="true" />
      </button>
      <button type="button" aria-label="Next agent" onClick={handleNext} disabled={!nextId}
        className={cn(
          "absolute right-2 top-1/2 z-10 -translate-y-1/2 cursor-pointer rounded-full bg-background/70 p-2 text-foreground hover:bg-background",
          !nextId && "pointer-events-none opacity-40",
        )}>
        <ChevronRight className="size-5" aria-hidden="true" />
      </button>
    </ModalShell>
  );
}
