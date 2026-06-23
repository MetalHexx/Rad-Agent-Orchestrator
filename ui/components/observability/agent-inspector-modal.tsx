"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
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
//   header = AgentIdentityHeader (bold label + descriptor, DD-2)
//   body   = FacetTabs + active panel (RawTranscriptView | empty state) + AgentPrevNext (FR-15)
//   footer = AgentNavigatorStrip (DD-1)
//
// Driven by useSessionAgents + useAgentInspector hooks.
// No onShare wired — deferred in 5.3 (AD-1).
// Content components receive props only (NFR-6).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// AgentIdentityHeader — bold label + muted descriptor (DD-2)
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
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="truncate font-semibold text-foreground leading-tight">{label}</span>
      {descriptor && (
        <span className="truncate text-xs text-muted-foreground leading-tight">{descriptor}</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AgentPrevNext — edge prev/next chevrons wired to the hook's nav + ←/→ keys (FR-15, DD-6)
// ---------------------------------------------------------------------------

interface AgentPrevNextProps {
  prevId: string | null;
  nextId: string | null;
  onPrev: () => void;
  onNext: () => void;
}

function AgentPrevNext({ prevId, nextId, onPrev, onNext }: AgentPrevNextProps) {
  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Previous agent"
        disabled={!prevId}
        onClick={onPrev}
        className="cursor-pointer"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Next agent"
        disabled={!nextId}
        onClick={onNext}
        className="cursor-pointer"
      >
        <ChevronRight className="size-4" aria-hidden="true" />
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AgentInspectorModal
// ---------------------------------------------------------------------------

export interface AgentInspectorModalProps {
  sessionId: string;
  agentId: string | null;
  /** Call when the user changes the active agent (chip or prev/next). */
  onSelectAgent: (transcriptId: string) => void;
  onClose: () => void;
  isFullScreen: boolean;
  onToggleFullScreen: () => void;
  dataState?: "open" | "closed";
}

export function AgentInspectorModal({
  sessionId, agentId, onSelectAgent, onClose, isFullScreen, onToggleFullScreen, dataState = "open",
}: AgentInspectorModalProps) {
  const { navList } = useSessionAgents(sessionId);
  const { transcript, activeFacet, setActiveFacet, prevId, nextId } = useAgentInspector(
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

  // Agent identity header slot (DD-2)
  const titleSlot = (
    <AgentIdentityHeader
      label={activeAgent?.label ?? agentId ?? 'Agent'}
      agentType={activeAgent?.agentType}
      role={activeAgent?.role}
    />
  );

  // Prev/next header actions slot (FR-15, DD-6)
  const headerActions = (
    <AgentPrevNext
      prevId={prevId}
      nextId={nextId}
      onPrev={handlePrev}
      onNext={handleNext}
    />
  );

  // Footer: agent navigator strip (DD-1)
  const footer = (
    <AgentNavigatorStrip
      agents={navList}
      activeId={agentId}
      onSelect={onSelectAgent}
    />
  );

  return (
    <ModalShell
      ariaLabel="Agent Inspector"
      title={titleSlot}
      headerActions={headerActions}
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
    </ModalShell>
  );
}
