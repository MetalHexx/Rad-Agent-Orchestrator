import type {
  PipelineState,
  PipelineTemplate,
  OrchestrationConfig,
  NodeState,
  StepNodeState,
  ForEachPhaseNodeState,
  ForEachTaskNodeState,
  ParallelNodeState,
  CorrectiveTaskEntry,
  IterationEntry,
  NodeDef,
} from './types.js';
import { NODE_STATUSES, GRAPH_STATUSES, ALLOWED_NODE_TRANSITIONS } from './constants.js';
import { validateStateSchema } from './schema-validator.js';
import { deriveCurrentNodePathFromMarkers } from './dag-walker.js';

const validNodeStatuses = new Set<string>(Object.values(NODE_STATUSES));
const validGraphStatuses = new Set<string>(Object.values(GRAPH_STATUSES));

/** Corrective entries hosted directly by a step node (empty when it hosts none). */
function stepCorrectives(node: NodeState): CorrectiveTaskEntry[] {
  return node.kind === 'step'
    ? ((node as StepNodeState).corrective_tasks ?? [])
    : [];
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Validate a proposed pipeline state.
 *
 * `opts.checkCursorHonesty` (default `true`) gates the `current_node_path`
 * honesty tripwire (checkCurrentNodePathHonest). That check is a
 * POST-recompute invariant: it only holds after the walker has advanced nodes
 * and `graph.current_node_path` has been re-derived from the in_progress
 * markers (the post-walk validate sites in engine.ts). The PRE-walk validate
 * sites pass `{ checkCursorHonesty: false }` because the cursor is
 * intentionally stale there — the mutation has been applied but the walker has
 * not yet run, so a childless corrective entry (a reified state object whose
 * derived path is the entry itself) would spuriously disagree with the
 * not-yet-recomputed cursor. Every other check (schema, status transitions,
 * immutable commit hash, corrective structure, etc.) runs at both sites.
 */
export function validateState(
  _previousState: PipelineState | null,
  proposedState: PipelineState,
  _config: OrchestrationConfig,
  template: PipelineTemplate,
  opts: { checkCursorHonesty?: boolean } = {},
): string[] {
  const { checkCursorHonesty = true } = opts;
  return [
    ...validateStateSchema(proposedState),     // schema check (must be first)
    ...checkGraphStatus(proposedState),
    ...checkCorrectiveTaskStructure(proposedState.graph.nodes, 'graph.nodes'),
    ...checkNodeStatuses(proposedState.graph.nodes, 'graph.nodes'),
    ...checkIterationIndices(proposedState.graph.nodes, 'graph.nodes'),
    ...checkCompletedParentChildren(proposedState.graph.nodes, 'graph.nodes'),
    ...checkCorrectiveEntriesTerminal(proposedState.graph.nodes, 'graph.nodes'),
    ...checkNodeKindMatchesTemplate(proposedState, template),
    ...checkStatusTransitions(_previousState, proposedState),
    ...checkImmutableCommitHash(_previousState, proposedState),
    ...(checkCursorHonesty ? checkCurrentNodePathHonest(proposedState) : []),
  ];
}

// ── Check: valid graph status ─────────────────────────────────────────────────

function checkGraphStatus(state: PipelineState): string[] {
  if (!validGraphStatuses.has(state.graph.status)) {
    return [`Invalid graph status: '${state.graph.status}'`];
  }
  return [];
}

// ── Check: valid node statuses (recursive) ────────────────────────────────────

function checkNodeStatuses(nodes: Record<string, NodeState>, path: string): string[] {
  const errors: string[] = [];
  for (const [id, node] of Object.entries(nodes)) {
    const nodePath = `${path}.${id}`;
    if (!validNodeStatuses.has(node.status)) {
      errors.push(`Invalid node status '${node.status}' at ${nodePath}`);
    }
    if (node.kind === 'for_each_phase' || node.kind === 'for_each_task') {
      for (const iter of node.iterations) {
        if (!validNodeStatuses.has(iter.status)) {
          errors.push(`Invalid iteration status '${iter.status}' at ${nodePath}.iterations[${iter.index}]`);
        }
        errors.push(...checkNodeStatuses(iter.nodes, `${nodePath}.iterations[${iter.index}].nodes`));
        for (const ct of iter.corrective_tasks) {
          errors.push(...checkNodeStatuses(ct.nodes, `${nodePath}.iterations[${iter.index}].corrective_tasks[${ct.index}].nodes`));
        }
      }
    }
    if (node.kind === 'parallel') {
      errors.push(...checkNodeStatuses(node.nodes, `${nodePath}.nodes`));
    }
    for (const ct of stepCorrectives(node)) {
      if (!validNodeStatuses.has(ct.status)) {
        errors.push(`Invalid corrective status '${ct.status}' at ${nodePath}.corrective_tasks[${ct.index}]`);
      }
      errors.push(...checkNodeStatuses(ct.nodes, `${nodePath}.corrective_tasks[${ct.index}].nodes`));
    }
  }
  return errors;
}

// ── Check: sequential iteration indices ───────────────────────────────────────

function checkIterationIndices(nodes: Record<string, NodeState>, path: string): string[] {
  const errors: string[] = [];
  for (const [id, node] of Object.entries(nodes)) {
    const nodePath = `${path}.${id}`;
    if (node.kind === 'for_each_phase' || node.kind === 'for_each_task') {
      for (let i = 0; i < node.iterations.length; i++) {
        const iter = node.iterations[i];
        if (iter.index !== i) {
          errors.push(`Iteration index mismatch at ${nodePath}.iterations[${i}]: expected ${i}, got ${iter.index}`);
        }
        for (let j = 0; j < iter.corrective_tasks.length; j++) {
          const ct = iter.corrective_tasks[j];
          if (ct.index !== j + 1) {
            errors.push(`Corrective task index mismatch at ${nodePath}.iterations[${i}].corrective_tasks[${j}]: expected ${j + 1}, got ${ct.index}`);
          }
        }
        // Recurse into iteration nodes
        errors.push(...checkIterationIndices(iter.nodes, `${nodePath}.iterations[${i}].nodes`));
      }
    }
    if (node.kind === 'parallel') {
      errors.push(...checkIterationIndices(node.nodes, `${nodePath}.nodes`));
    }
    // Step-hosted corrective entries: 1-based and contiguous across the WHOLE
    // array — the budget window (corrective_budget_origin) does not renumber.
    const cts = stepCorrectives(node);
    for (let j = 0; j < cts.length; j++) {
      const ct = cts[j];
      if (ct.index !== j + 1) {
        errors.push(`Corrective task index mismatch at ${nodePath}.corrective_tasks[${j}]: expected ${j + 1}, got ${ct.index}`);
      }
      errors.push(...checkIterationIndices(ct.nodes, `${nodePath}.corrective_tasks[${ct.index}].nodes`));
    }
  }
  return errors;
}

// ── Check: no in_progress children under completed parent ─────────────────────

function checkCompletedParentChildren(nodes: Record<string, NodeState>, path: string): string[] {
  const errors: string[] = [];
  for (const [id, node] of Object.entries(nodes)) {
    const nodePath = `${path}.${id}`;
    if (node.kind === 'for_each_phase' || node.kind === 'for_each_task') {
      if (node.status === 'completed') {
        for (const iter of node.iterations) {
          errors.push(...findInProgressNodes(iter.nodes, `${nodePath}.iterations[${iter.index}].nodes`, nodePath));
          for (const ct of iter.corrective_tasks) {
            errors.push(...findInProgressNodes(ct.nodes, `${nodePath}.iterations[${iter.index}].corrective_tasks[${ct.index}].nodes`, nodePath));
          }
        }
      }
      // Recurse even when not completed to check nested for_each / parallel nodes
      for (const iter of node.iterations) {
        errors.push(...checkCompletedParentChildren(iter.nodes, `${nodePath}.iterations[${iter.index}].nodes`));
        for (const ct of iter.corrective_tasks) {
          errors.push(...checkCompletedParentChildren(ct.nodes, `${nodePath}.iterations[${iter.index}].corrective_tasks[${ct.index}].nodes`));
        }
      }
    }
    if (node.kind === 'parallel') {
      if (node.status === 'completed') {
        errors.push(...findInProgressNodes(node.nodes, `${nodePath}.nodes`, nodePath));
      }
      // Recurse
      errors.push(...checkCompletedParentChildren(node.nodes, `${nodePath}.nodes`));
    }
    // A completed step host may hold no in_progress descendant inside its
    // corrective entries.
    if (node.status === 'completed') {
      for (const ct of stepCorrectives(node)) {
        errors.push(...findInProgressNodes(ct.nodes, `${nodePath}.corrective_tasks[${ct.index}].nodes`, nodePath));
      }
    }
    // Recurse even when not completed to check nested for_each / parallel nodes
    for (const ct of stepCorrectives(node)) {
      errors.push(...checkCompletedParentChildren(ct.nodes, `${nodePath}.corrective_tasks[${ct.index}].nodes`));
    }
  }
  return errors;
}

function findInProgressNodes(nodes: Record<string, NodeState>, path: string, parentPath: string): string[] {
  const errors: string[] = [];
  for (const [id, node] of Object.entries(nodes)) {
    if (node.status === 'in_progress') {
      errors.push(`Node '${path}.${id}' is in_progress but parent '${parentPath}' is completed`);
    }
    // Check deeper nesting
    if (node.kind === 'for_each_phase' || node.kind === 'for_each_task') {
      for (const iter of node.iterations) {
        errors.push(...findInProgressNodes(iter.nodes, `${path}.${id}.iterations[${iter.index}].nodes`, parentPath));
        for (const ct of iter.corrective_tasks) {
          errors.push(...findInProgressNodes(ct.nodes, `${path}.${id}.iterations[${iter.index}].corrective_tasks[${ct.index}].nodes`, parentPath));
        }
      }
    }
    if (node.kind === 'parallel') {
      errors.push(...findInProgressNodes(node.nodes, `${path}.${id}.nodes`, parentPath));
    }
    for (const ct of stepCorrectives(node)) {
      errors.push(...findInProgressNodes(ct.nodes, `${path}.${id}.corrective_tasks[${ct.index}].nodes`, parentPath));
    }
  }
  return errors;
}

// ── Check: completed iteration ⇒ all corrective entries terminal ──────────────

// A completed for-each iteration must contain only terminal corrective entries.
// Catches the corrective-of-a-corrective stranding bug class at validate time: a
// corrective entry left non-terminal (in_progress / not_started) under a
// completed iteration, sitting before a completed sibling. This is the
// defense-in-depth backstop for the mutations.ts fix that finalizes a superseded
// parent corrective when its successor is born. Not cursor-related, so it runs
// at BOTH the pre- and post-walk validate sites (it is NOT gated by
// checkCursorHonesty); with the mutation in place it always passes, but without
// it the post-walk validate that marked the iteration completed hard-rejects
// instead of silently corrupting state.
function checkCorrectiveEntriesTerminal(nodes: Record<string, NodeState>, path: string): string[] {
  const errors: string[] = [];
  for (const [id, node] of Object.entries(nodes)) {
    const nodePath = `${path}.${id}`;
    if (node.kind === 'for_each_phase' || node.kind === 'for_each_task') {
      for (const iter of node.iterations) {
        // Gate on the ITERATION status (not the for-each node status): a stranded
        // corrective in a completed phase N must be flagged even while phase N+1
        // is still running and the for-each node is therefore in_progress.
        if (iter.status === 'completed') {
          for (const ct of iter.corrective_tasks) {
            if (ct.status !== 'completed' && ct.status !== 'skipped') {
              errors.push(
                `Corrective entry '${nodePath}.iterations[${iter.index}].corrective_tasks[${ct.index}]' ` +
                `has status '${ct.status}' but the iteration is completed ` +
                `(all corrective entries under a completed iteration must be terminal: completed or skipped)`,
              );
            }
          }
        }
        // Recurse into nested for-each (phase_loop → task_loop).
        errors.push(...checkCorrectiveEntriesTerminal(iter.nodes, `${nodePath}.iterations[${iter.index}].nodes`));
      }
    }
    if (node.kind === 'parallel') {
      errors.push(...checkCorrectiveEntriesTerminal(node.nodes, `${nodePath}.nodes`));
    }
    // Gate on the STEP's own status (not the iteration/for-each): a completed
    // step host (e.g. final_review) may hold only terminal corrective entries.
    // A host re-opened for a fresh round is not gated here and must pass even
    // while holding completed entries.
    if (node.status === 'completed') {
      for (const ct of stepCorrectives(node)) {
        if (ct.status !== 'completed' && ct.status !== 'skipped') {
          errors.push(
            `Corrective entry '${nodePath}.corrective_tasks[${ct.index}]' ` +
            `has status '${ct.status}' but the step host is completed ` +
            `(all corrective entries under a completed step host must be terminal: completed or skipped)`,
          );
        }
      }
    }
    for (const ct of stepCorrectives(node)) {
      errors.push(...checkCorrectiveEntriesTerminal(ct.nodes, `${nodePath}.corrective_tasks[${ct.index}].nodes`));
    }
  }
  return errors;
}

// ── Check: corrective task structure ──────────────────────────────────────────

function checkCorrectiveTaskStructure(nodes: Record<string, NodeState>, path: string): string[] {
  const errors: string[] = [];
  for (const [id, node] of Object.entries(nodes)) {
    const nodePath = `${path}.${id}`;
    if (node.kind === 'for_each_phase' || node.kind === 'for_each_task') {
      for (const iter of node.iterations) {
        for (const ct of iter.corrective_tasks) {
          errors.push(...validateCorrectiveEntry(ct, `${nodePath}.iterations[${iter.index}].corrective_tasks[${ct.index}]`));
        }
        errors.push(...checkCorrectiveTaskStructure(iter.nodes, `${nodePath}.iterations[${iter.index}].nodes`));
      }
    }
    if (node.kind === 'parallel') {
      errors.push(...checkCorrectiveTaskStructure(node.nodes, `${nodePath}.nodes`));
    }
    if (node.kind === 'step') {
      // Bound check runs unconditionally here (unlike the mirrored check in
      // compareNodes, which only fires when previousState is non-null) so a
      // hand-edited or stale snapshot loaded via validateState(null, ...) at
      // engine start/resume can't silently carry an out-of-range origin.
      const cts = stepCorrectives(node);
      const origin = node.corrective_budget_origin ?? 0;
      if (origin > cts.length) {
        errors.push(
          `corrective_budget_origin at ${nodePath} (${origin}) exceeds corrective_tasks.length (${cts.length})`,
        );
      }
    }
    for (const ct of stepCorrectives(node)) {
      errors.push(...validateCorrectiveEntry(ct, `${nodePath}.corrective_tasks[${ct.index}]`));
      errors.push(...checkCorrectiveTaskStructure(ct.nodes, `${nodePath}.corrective_tasks[${ct.index}].nodes`));
    }
  }
  return errors;
}

function validateCorrectiveEntry(ct: CorrectiveTaskEntry, path: string): string[] {
  const errors: string[] = [];
  if (typeof ct.index !== 'number' || ct.index < 1) {
    errors.push(`Corrective task at ${path} has invalid index: ${ct.index} (must be >= 1)`);
  }
  if (typeof ct.reason !== 'string' || ct.reason.length === 0) {
    errors.push(`Corrective task at ${path} has empty or missing reason`);
  }
  if (typeof ct.injected_after !== 'string' || ct.injected_after.length === 0) {
    errors.push(`Corrective task at ${path} has empty or missing injected_after`);
  }
  if (!validNodeStatuses.has(ct.status)) {
    errors.push(`Corrective task at ${path} has invalid status: '${ct.status}'`);
  }
  if (!ct.nodes || typeof ct.nodes !== 'object') {
    errors.push(`Corrective task at ${path} has missing or invalid nodes`);
  } else if (ct.injected_after !== 'phase_review' && Object.keys(ct.nodes).length === 0) {
    // Phase correctives (injected_after === 'phase_review') intentionally have nodes: {}
    // because tasks are created by the subsequent phase planning step.
    // Task-level correctives must have scaffolded body nodes.
    errors.push(`Corrective task at ${path} has empty or missing nodes`);
  }
  return errors;
}

// ── Check: node kind matches template ─────────────────────────────────────────

function collectNodeDefKinds(nodes: NodeDef[], map: Map<string, string>): void {
  for (const nodeDef of nodes) {
    map.set(nodeDef.id, nodeDef.kind);
    if (nodeDef.kind === 'for_each_phase' || nodeDef.kind === 'for_each_task') {
      collectNodeDefKinds(nodeDef.body, map);
    }
    if (nodeDef.kind === 'conditional') {
      collectNodeDefKinds(nodeDef.branches.true, map);
      collectNodeDefKinds(nodeDef.branches.false, map);
    }
    if (nodeDef.kind === 'parallel') {
      collectNodeDefKinds(nodeDef.children, map);
    }
  }
}

function checkNodeKindMatchesTemplate(state: PipelineState, template: PipelineTemplate): string[] {
  const errors: string[] = [];
  const templateKindMap = new Map<string, string>();
  collectNodeDefKinds(template.nodes, templateKindMap);

  function walkStateNodes(nodes: Record<string, NodeState>, path: string): void {
    for (const [id, node] of Object.entries(nodes)) {
      const nodePath = `${path}.${id}`;
      const templateKind = templateKindMap.get(id);
      if (templateKind !== undefined && node.kind !== templateKind) {
        errors.push(`Node '${id}' has kind '${node.kind}' but template defines kind '${templateKind}'`);
      }
      if (node.kind === 'for_each_phase' || node.kind === 'for_each_task') {
        for (const iter of node.iterations) {
          walkStateNodes(iter.nodes, `${nodePath}.iterations[${iter.index}].nodes`);
          for (const ct of iter.corrective_tasks) {
            walkStateNodes(ct.nodes, `${nodePath}.iterations[${iter.index}].corrective_tasks[${ct.index}].nodes`);
          }
        }
      }
      if (node.kind === 'parallel') {
        walkStateNodes(node.nodes, `${nodePath}.nodes`);
      }
      for (const ct of stepCorrectives(node)) {
        walkStateNodes(ct.nodes, `${nodePath}.corrective_tasks[${ct.index}].nodes`);
      }
    }
  }

  walkStateNodes(state.graph.nodes, 'graph.nodes');
  return errors;
}

// ── Check: status transitions ─────────────────────────────────────────────────

function checkStatusTransitions(
  previousState: PipelineState | null,
  proposedState: PipelineState,
): string[] {
  if (!previousState) return [];
  const errors: string[] = [];
  compareNodes(
    previousState.graph.nodes,
    proposedState.graph.nodes,
    'graph.nodes',
    errors,
  );
  return errors;
}

// ── Check: immutable commit_hash ──────────────────────────────────────────────

function checkImmutableCommitHash(
  previousState: PipelineState | null,
  proposedState: PipelineState,
): string[] {
  if (!previousState) return [];
  const errors: string[] = [];

  // Compares every repo (matched by `name`, not just index 0) between a prior
  // and proposed repos[] array, pushing an error for each repo whose recorded
  // commit_hash changed. A multi-repo corrective can commit repos[1] while
  // repos[0] stays null — checking only index 0 would miss that mutation.
  function compareRepoHashes(
    prevEntry: { repos?: Array<{ name: string; commit_hash: string | null }> } | undefined,
    currEntry: { repos?: Array<{ name: string; commit_hash: string | null }> } | undefined,
    label: string,
  ): void {
    const prevRepos = prevEntry?.repos ?? [];
    const currRepos = currEntry?.repos ?? [];
    for (const currRepo of currRepos) {
      const prevRepo = prevRepos.find(r => r.name === currRepo.name);
      if (!prevRepo) continue;
      const before = prevRepo.commit_hash;
      const after = currRepo.commit_hash;
      if (before != null && after != null && before !== after) {
        errors.push(`Immutable commit_hash violation at ${label} (repo '${currRepo.name}'): '${before}' → '${after}'`);
      }
    }
  }

  function compare(prev: Record<string, NodeState>, curr: Record<string, NodeState>, path: string): void {
    for (const [id, currNode] of Object.entries(curr)) {
      const prevNode = prev[id];
      if (!prevNode) continue;
      if (
        (currNode.kind === 'for_each_phase' || currNode.kind === 'for_each_task') &&
        (prevNode.kind === 'for_each_phase' || prevNode.kind === 'for_each_task')
      ) {
        const prevIters = (prevNode as ForEachPhaseNodeState | ForEachTaskNodeState).iterations;
        for (const currIter of currNode.iterations) {
          const prevIter = prevIters[currIter.index];
          if (!prevIter) continue;
          compareRepoHashes(
            prevIter as unknown as { repos?: Array<{ name: string; commit_hash: string | null }> },
            currIter as unknown as { repos?: Array<{ name: string; commit_hash: string | null }> },
            `${path}.${id}.iterations[${currIter.index}]`,
          );
          for (const currCt of currIter.corrective_tasks) {
            const prevCt = prevIter.corrective_tasks.find(ct => ct.index === currCt.index);
            if (!prevCt) continue;
            compareRepoHashes(
              prevCt as unknown as { repos?: Array<{ name: string; commit_hash: string | null }> },
              currCt as unknown as { repos?: Array<{ name: string; commit_hash: string | null }> },
              `${path}.${id}.iterations[${currIter.index}].corrective_tasks[${currCt.index}]`,
            );
            compare(prevCt.nodes, currCt.nodes, `${path}.${id}.iterations[${currIter.index}].corrective_tasks[${currCt.index}].nodes`);
          }
          compare(prevIter.nodes, currIter.nodes, `${path}.${id}.iterations[${currIter.index}].nodes`);
        }
      }
      if (currNode.kind === 'parallel' && prevNode.kind === 'parallel') {
        compare(prevNode.nodes, currNode.nodes, `${path}.${id}.nodes`);
      }
      if (currNode.kind === 'step' && prevNode.kind === 'step') {
        const prevCts = stepCorrectives(prevNode);
        for (const currCt of stepCorrectives(currNode)) {
          const prevCt = prevCts.find(ct => ct.index === currCt.index);
          if (!prevCt) continue;
          compareRepoHashes(
            prevCt as unknown as { repos?: Array<{ name: string; commit_hash: string | null }> },
            currCt as unknown as { repos?: Array<{ name: string; commit_hash: string | null }> },
            `${path}.${id}.corrective_tasks[${currCt.index}]`,
          );
          compare(prevCt.nodes, currCt.nodes, `${path}.${id}.corrective_tasks[${currCt.index}].nodes`);
        }
      }
    }
  }

  compare(previousState.graph.nodes, proposedState.graph.nodes, 'graph.nodes');
  return errors;
}

function compareNodes(
  prevNodes: Record<string, NodeState>,
  currNodes: Record<string, NodeState>,
  path: string,
  errors: string[],
): void {
  for (const [id, currNode] of Object.entries(currNodes)) {
    const prevNode = prevNodes[id];
    if (!prevNode) continue; // new node — no transition to validate

    if (prevNode.status !== currNode.status) {
      const allowed = ALLOWED_NODE_TRANSITIONS.get(prevNode.status);
      // Only flag transitions originating from terminal states (empty allowed set).
      // Non-terminal states (in_progress, completed, etc.) may undergo multi-step
      // atomic resets within a single mutation boundary that appear as a single
      // cross-boundary jump; those are validated by checkNodeStatuses instead.
      if (allowed && allowed.size === 0) {
        errors.push(
          `Illegal status transition at ${path}.${id}: '${prevNode.status}' → '${currNode.status}'`
        );
      }
    }

    // Recurse into for_each_phase / for_each_task iterations
    if (
      (currNode.kind === 'for_each_phase' || currNode.kind === 'for_each_task') &&
      (prevNode.kind === 'for_each_phase' || prevNode.kind === 'for_each_task')
    ) {
      for (const currIter of currNode.iterations) {
        const prevIter = (prevNode as ForEachPhaseNodeState | ForEachTaskNodeState)
          .iterations[currIter.index];
        if (!prevIter) continue; // new iteration — skip
        compareNodes(prevIter.nodes, currIter.nodes, `${path}.${id}.iterations[${currIter.index}].nodes`, errors);

        // Recurse into corrective_tasks
        for (const currCt of currIter.corrective_tasks) {
          const prevCt = prevIter.corrective_tasks.find(ct => ct.index === currCt.index);
          if (!prevCt) continue;
          compareNodes(prevCt.nodes, currCt.nodes,
            `${path}.${id}.iterations[${currIter.index}].corrective_tasks[${currCt.index}].nodes`, errors);
        }
      }
    }

    // Recurse into parallel branches
    if (currNode.kind === 'parallel' && prevNode.kind === 'parallel') {
      compareNodes(prevNode.nodes, currNode.nodes, `${path}.${id}.nodes`, errors);
    }

    // Recurse into step-hosted corrective entries, matched by index
    if (currNode.kind === 'step' && prevNode.kind === 'step') {
      const prevCts = stepCorrectives(prevNode);
      const currCts = stepCorrectives(currNode);
      for (const currCt of currCts) {
        const prevCt = prevCts.find(ct => ct.index === currCt.index);
        if (!prevCt) continue;
        compareNodes(prevCt.nodes, currCt.nodes, `${path}.${id}.corrective_tasks[${currCt.index}].nodes`, errors);
      }

      // corrective_budget_origin is monotonic: it may only stay equal or
      // increase, and may never exceed the current entry count. A decrease
      // would silently re-open a spent budget window.
      const prevOrigin = prevNode.corrective_budget_origin ?? 0;
      const currOrigin = currNode.corrective_budget_origin ?? 0;
      if (currOrigin < prevOrigin) {
        errors.push(
          `corrective_budget_origin decreased at ${path}.${id}: ${prevOrigin} → ${currOrigin} ` +
          `(would silently re-open a spent budget window)`,
        );
      }
      if (currOrigin > currCts.length) {
        errors.push(
          `corrective_budget_origin at ${path}.${id} (${currOrigin}) exceeds corrective_tasks.length (${currCts.length})`,
        );
      }
    }
  }
}

// ── Check: current_node_path honest tripwire (FR-8, FR-9, AD-1, NFR-1) ───────

/**
 * Verifies that `current_node_path` agrees with the in_progress marker
 * derived from the state tree. When at least one node is in_progress, the
 * cursor must equal the derived path; when no node is in_progress (terminal
 * or not-yet-started) the check is silently skipped (NFR-1 tolerance).
 */
function checkCurrentNodePathHonest(state: PipelineState): string[] {
  const derived = deriveCurrentNodePathFromMarkers(state);
  if (derived === null) return []; // terminal / no active node — tolerate
  if (state.graph.current_node_path !== derived) {
    return [
      `current_node_path tripwire: cursor '${state.graph.current_node_path}' disagrees with ` +
      `in_progress markers (expected '${derived}'). The echoed context is stale.`,
    ];
  }
  return [];
}
