"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { NodesRecord, NodeState } from "@/types/state";
import {
  buildIterationItemValue,
  buildCorrectiveItemValue,
} from "@/components/dag-timeline/dag-timeline-helpers";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface UseFollowModeReturn {
  followMode: boolean;
  expandedLoopIds: string[];
  onAccordionChange: (
    value: string[],
    eventDetails: { reason: string }
  ) => void;
  toggleFollowMode: () => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Recursively walk a v5 nodes record and return the ordered list of
 * accordion item values for every active iteration and corrective task:
 *
 *   - One `iter-${nodeId}-${index}` key per `in_progress` iteration inside
 *     every `for_each_phase` / `for_each_task` node (FR-12, AD-3).
 *   - One `ct-${iterKey}-${ctIndex}` key per `in_progress` corrective task
 *     nested under that iteration, emitted additively alongside its parent
 *     iteration key (DD-7, FR-13).
 *
 * Recursion covers:
 *   - `parallel.nodes` (nested loops inside a parallel block)
 *   - Each iteration's `nodes` record on `for_each_phase` / `for_each_task`
 *     entries using a compound path prefix so sibling loops at different
 *     nesting levels produce unique, unambiguous keys
 *     (e.g. `task_loop` nested in `phase_loop.iter0` →
 *     `iter-phase_loop.iter0.task_loop-1`).
 *
 * Iteration status is the single source of truth for expansion — only
 * `in_progress` iterations and corrective tasks contribute keys.
 */
export function computeSmartDefaults(nodes: NodesRecord | null): string[] {
  if (nodes === null) return [];
  const result: string[] = [];
  walkNodes(nodes, result);
  return result;
}

function walkNodes(nodes: NodesRecord, result: string[], pathPrefix?: string): void {
  for (const nodeId of Object.keys(nodes)) {
    const node: NodeState | undefined = nodes[nodeId];
    if (!node) continue;

    // Compute the fully-qualified node ID — compound when nested inside an
    // iteration, plain when at the top level.
    const qualifiedId = pathPrefix != null ? `${pathPrefix}.${nodeId}` : nodeId;

    if (node.kind === "for_each_phase" || node.kind === "for_each_task") {
      // Only descend into active loops — a not_started/completed loop has
      // no active iteration to expand. This keys off node.kind (FR-18) so
      // any future for_each_* template is handled the same way.
      if (node.status !== "in_progress") {
        // Recurse into sub-iterations anyway in case a completed parent
        // loop holds a still-running nested loop (defensive — the
        // pipeline should not produce this shape, but the walk must not
        // skip an active descendant).
        for (const iteration of node.iterations) {
          walkNodes(iteration.nodes, result, `${qualifiedId}.iter${iteration.index}`);
        }
        continue;
      }
      for (const iteration of node.iterations) {
        if (iteration.status === "in_progress") {
          const iterKey = buildIterationItemValue(qualifiedId, iteration.index);
          result.push(iterKey);
          // Active correctives auto-open additively (DD-7) — they sit
          // alongside the parent iteration in the expansion set.
          for (const ct of iteration.corrective_tasks) {
            if (ct.status === "in_progress") {
              result.push(buildCorrectiveItemValue(iterKey, ct.index));
            }
          }
        }
        // Recurse into every iteration's nodes regardless of iteration
        // status so a still-active task_loop nested under a just-completed
        // phase iteration is still discovered.
        walkNodes(iteration.nodes, result, `${qualifiedId}.iter${iteration.index}`);
      }
    } else if (node.kind === "parallel") {
      walkNodes(node.nodes, result, pathPrefix);
    } else if (node.kind === "step" && node.corrective_tasks) {
      // Step nodes may host correctives (final_review, or custom step hosts).
      // Emit ct-... keys for in_progress entries; emit all regardless of
      // budget window — an entry cannot be in_progress outside the window anyway.
      for (const ct of node.corrective_tasks) {
        if (ct.status === "in_progress") {
          result.push(buildCorrectiveItemValue(qualifiedId, ct.index));
        }
      }
    }
    // gate / conditional nodes have no nested loop / iteration
    // children — skip. step nodes without corrective_tasks also skip here.
  }
}

/**
 * Shallow-equal comparison for string arrays — returns true when both arrays
 * have the same length and the same items in the same order.
 */
function shallowEqualStringArrays(a: readonly string[], b: readonly string[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// Exported for tests — the helper above is pure and has no React dependencies.
export const __shallowEqualStringArrays = shallowEqualStringArrays;

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * `useFollowMode` owns follow-mode state for the DAG timeline. It:
 *
 *   1. Computes smart defaults from the v5 nodes record — expanding active
 *      iterations (`status === 'in_progress'`) and collapsing everything else.
 *   2. Reacts to SSE-driven `nodes` changes while follow-mode is engaged, so
 *      the active iteration stays expanded as the pipeline progresses.
 *   3. Disengages follow-mode silently on any user-initiated accordion
 *      interaction, guarded by the `isProgrammaticRef` suppression flag.
 *      The reason field on `onValueChange` is unreliable — base-ui's
 *      `AccordionRoot.handleValueChange` hardcodes it to `REASONS.none`
 *      regardless of whether the origin was a user click or an imperative
 *      update, so we cannot discriminate by reason. However, controlled
 *      `value`-prop updates do NOT fire `onValueChange` at all (base-ui
 *      uses `useControlled`, which updates state silently), so every
 *      callback invocation is in fact a user interaction. The suppression
 *      flag is kept as defense-in-depth: it is set immediately before every
 *      hook-initiated state update and cleared via `queueMicrotask`.
 *   4. Resets to smart defaults + re-engages follow-mode when the selected
 *      project changes.
 *
 * When `nodes === null` (no project selected or v4 project), the hook returns
 * `followMode: true`, `expandedLoopIds: []`, and stable no-op callbacks — so
 * callers can invoke it unconditionally from the page.
 */
export function useFollowMode(
  nodes: NodesRecord | null,
  selectedProject: string | null
): UseFollowModeReturn {
  const [followMode, setFollowMode] = useState<boolean>(true);
  const [expandedLoopIds, setExpandedLoopIds] = useState<string[]>([]);
  const isProgrammaticRef = useRef<boolean>(false);
  const prevProjectRef = useRef<string | null>(selectedProject);

  // ── SSE-driven reactivity ──────────────────────────────────────────────────
  // Piggybacks on React re-renders produced by the existing `useProjects` SSE
  // pipeline — the hook does NOT register its own SSE listener.
  //
  // Uses a functional setter so the shallow-equal short-circuit reads the
  // up-to-date expanded list without needing to add `expandedLoopIds` to the
  // effect's dep array (the handoff keys this effect on `[nodes, followMode]`
  // exactly).
  useEffect(() => {
    if (!followMode) return;
    const nextExpanded = computeSmartDefaults(nodes);
    let didUpdate = false;
    setExpandedLoopIds((current) => {
      if (shallowEqualStringArrays(current, nextExpanded)) return current;
      didUpdate = true;
      return nextExpanded;
    });
    if (didUpdate) {
      isProgrammaticRef.current = true;
      queueMicrotask(() => {
        isProgrammaticRef.current = false;
      });
    }
  }, [nodes, followMode]);

  // ── Project-reset effect ───────────────────────────────────────────────────
  // Follow-mode is per-project and per-session. When the user switches
  // projects, re-engage follow-mode and snap to smart defaults.
  useEffect(() => {
    if (selectedProject === prevProjectRef.current) return;
    prevProjectRef.current = selectedProject;
    isProgrammaticRef.current = true;
    setFollowMode(true);
    setExpandedLoopIds(computeSmartDefaults(nodes));
    queueMicrotask(() => {
      isProgrammaticRef.current = false;
    });
    // `nodes` is intentionally read at the moment of the project switch — we
    // don't want this effect to re-fire on every nodes change, only on
    // selectedProject changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProject]);

  // ── Accordion change handler ───────────────────────────────────────────────
  // Always mirror the new value into `expandedLoopIds` so the UI reflects the
  // click immediately. Then disengage follow-mode unless the update came from
  // our own programmatic path.
  //
  // Why no reason check: base-ui's `AccordionRoot.handleValueChange` hardcodes
  // `details.reason` to `REASONS.none` (see AccordionRoot.js:73), so the type's
  // `triggerPress | none` union is not usable at runtime. Controlled
  // `value`-prop updates don't fire `onValueChange` — `useControlled` updates
  // state silently — so every callback invocation is a user click.
  // Disengagement is silent: no toast / banner / log.
  const onAccordionChange = useCallback(
    (value: string[], _eventDetails: { reason: string }) => {
      setExpandedLoopIds(value);
      if (!isProgrammaticRef.current) {
        setFollowMode(false);
      }
    },
    []
  );

  // ── Toggle ────────────────────────────────────────────────────────────────
  // The toolbar's Follow Mode switch invokes this. On→Off disengages silently
  // and leaves the current expansion alone so the user's view is preserved.
  // Off→On re-engages and re-applies smart defaults through the
  // suppression-flag-guarded path so the ensuing `onValueChange` callback
  // from the accordion is not misread as a user interaction.
  const toggleFollowMode = useCallback(() => {
    if (followMode) {
      setFollowMode(false);
      return;
    }
    const nextExpanded = computeSmartDefaults(nodes);
    isProgrammaticRef.current = true;
    setFollowMode(true);
    setExpandedLoopIds(nextExpanded);
    queueMicrotask(() => {
      isProgrammaticRef.current = false;
    });
  }, [followMode, nodes]);

  // ── `nodes === null` fallback ──────────────────────────────────────────────
  // No project selected or v4 project — return safe defaults and no-op
  // callbacks. The callbacks above are already stable (memoized with []
  // / [nodes]), so we return a fresh object but the callback identities are
  // preserved across renders.
  if (nodes === null) {
    return {
      followMode: true,
      expandedLoopIds: EMPTY_ARRAY,
      onAccordionChange: NOOP_ON_ACCORDION_CHANGE,
      toggleFollowMode: NOOP_TOGGLE,
    };
  }

  return {
    followMode,
    expandedLoopIds,
    onAccordionChange,
    toggleFollowMode,
  };
}

// Stable module-scope constants for the `nodes === null` fallback so every
// call with `nodes === null` returns reference-equal callbacks and array.
const EMPTY_ARRAY: string[] = [];
const NOOP_ON_ACCORDION_CHANGE = (_value: string[], _eventDetails: { reason: string }): void => {
  // no-op — the hook has no project to track
};
const NOOP_TOGGLE = (): void => {
  // no-op — the hook has no project to track
};
