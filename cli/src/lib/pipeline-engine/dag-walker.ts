import type {
  PipelineState,
  PipelineTemplate,
  OrchestrationConfig,
  WalkerResult,
  EventContext,
  NodeState,
  NodeDef,
  GateNodeDef,
  StepNodeDef,
  GateNodeState,
  StepNodeState,
  ConditionalNodeDef,
  ParallelNodeDef,
  ConditionalNodeState,
  ParallelNodeState,
  ForEachPhaseNodeDef,
  ForEachPhaseNodeState,
  ForEachTaskNodeDef,
  ForEachTaskNodeState,
  GraphState,
  IterationEntry,
} from './types.js';
import { NODE_STATUSES, NEXT_ACTIONS, GRAPH_STATUSES } from './constants.js';
import { evaluateCondition } from './condition-evaluator.js';
import { scaffoldNodeState } from './scaffold.js';

/**
 * Resolves a template path to a state path by substituting iteration indices.
 * Template paths use ".body." to represent iteration body contents.
 * This function replaces those segments with "[index]." using the event context.
 *
 * Examples:
 *   ("phase_loop.body.task_loop.body.code_review", {phase:1, task:2}) → "phase_loop[0].task_loop[1].code_review"
 *   ("phase_loop.body.phase_review", {phase:2}) → "phase_loop[1].phase_review"
 *   ("research", {}) → "research"
 */
export function resolveNodeStatePath(
  templatePath: string,
  _context: Partial<EventContext>,
): string {
  let result = templatePath;
  if (_context.phase !== undefined) {
    result = result.replaceAll('phase_loop.body.', `phase_loop[${_context.phase - 1}].`);
  }
  if (_context.task !== undefined) {
    result = result.replaceAll('task_loop.body.', `task_loop[${_context.task - 1}].`);
  }
  return result;
}

/**
 * Navigates a dot-path (e.g., "human_gates.after_planning") into a config
 * object and returns the resolved value. Returns undefined if the path
 * does not resolve.
 */
function resolveConfigValue(
  dotPath: string,
  config: OrchestrationConfig,
): unknown {
  const segments = dotPath.split('.');
  let current: unknown = config;
  for (const segment of segments) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Checks whether all dependencies in a node's depends_on array are satisfied.
 * A dependency is satisfied if its status is 'completed' or 'skipped'.
 * Returns true if depends_on is empty or undefined.
 */
function checkDependencies(
  dependsOn: string[] | undefined,
  nodes: Record<string, NodeState>,
): boolean {
  if (!dependsOn || dependsOn.length === 0) {
    return true;
  }
  return dependsOn.every((depId) => {
    const depState = nodes[depId];
    return (
      depState !== undefined &&
      (depState.status === NODE_STATUSES.COMPLETED ||
        depState.status === NODE_STATUSES.SKIPPED)
    );
  });
}

/**
 * Resolves a JSON-path reference (e.g., "$.nodes.master_plan.doc_path") against
 * the graph state. Strips leading "$." prefix, splits by ".", and navigates
 * the state.graph object segment by segment.
 */
function resolveStateRef(ref: string, graphState: GraphState): unknown {
  const path = ref.startsWith('$.') ? ref.slice(2) : ref;
  const segments = path.split('.');
  let current: unknown = graphState;
  for (const segment of segments) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Resolves a source_doc_ref within a scope. Handles the literal ref
 * "$.current_phase.doc_path" by reading from the enclosing phase
 * iteration's `doc_path` field. Any other `$.current_phase.*` ref falls
 * through to `resolveStateRef`, which reads the global graph and will
 * silently return `undefined` — if a future template adds a new
 * `$.current_phase.<field>` ref, extend this function explicitly.
 */
function resolveDocRefInScope(
  ref: string,
  graphState: GraphState,
  currentIteration: IterationEntry | undefined,
): unknown {
  if (ref === '$.current_phase.doc_path') {
    return currentIteration?.doc_path ?? undefined;
  }
  return resolveStateRef(ref, graphState);
}

/**
 * Walks the iterations of a for_each_phase or for_each_task node sequentially,
 * advancing statuses and returning the first actionable result. Returns
 * 'all_completed' when every iteration has been completed or skipped.
 */
/**
 * Finalize an iteration that completes via the corrective-completion
 * short-circuit. Body nodes ordered AFTER the review node (e.g. phase_gate after
 * phase_review, task_gate after code_review) are never walked when a corrective
 * closes the iteration, so they remain `not_started`. They were bypassed by the
 * corrective close, not executed, so the honest terminal status is `skipped`.
 * Sweep only the iteration's DIRECT body nodes — never recurse into task_loop or
 * any other container. Idempotent (re-sweeping already-terminal nodes is a
 * no-op). Only the corrective-completion path calls this; normal completion
 * walks its gates to `completed` as usual.
 */
function skipUnreachedIterationBodyNodes(iteration: IterationEntry): void {
  for (const node of Object.values(iteration.nodes)) {
    if (node.status === NODE_STATUSES.NOT_STARTED) {
      node.status = NODE_STATUSES.SKIPPED;
    }
  }
}

function walkForEachIterations(
  fepDef: ForEachPhaseNodeDef | ForEachTaskNodeDef,
  fepState: ForEachPhaseNodeState | ForEachTaskNodeState,
  config: OrchestrationConfig,
  state: PipelineState,
  readDocument?: (docPath: string) => { frontmatter: Record<string, unknown> } | null,
): WalkerResult | null | 'all_completed' {
  for (const iteration of fepState.iterations) {
    if (iteration.status === NODE_STATUSES.COMPLETED || iteration.status === NODE_STATUSES.SKIPPED) {
      continue;
    }
    if (iteration.status === NODE_STATUSES.HALTED) {
      return { action: NEXT_ACTIONS.DISPLAY_HALTED, context: { details: state.pipeline.halt_reason ?? 'Pipeline is halted' } };
    }
    if (iteration.status === NODE_STATUSES.NOT_STARTED) {
      iteration.status = NODE_STATUSES.IN_PROGRESS;
    }

    // Scaffold any missing body nodes before walking into the iteration.
    // Runs whether we just transitioned to in_progress or re-entered an
    // already-in-progress iteration (self-heals CHEAPER-PIPELINE-TEST-1-era
    // stall states where the iteration had status=in_progress but
    // iteration.nodes was empty or partial).
    //
    // Rebuild iteration.nodes in template declaration order so the UI
    // (which renders by insertion order) sees a consistent layout whether
    // the iteration was pre-seeded, partially seeded, or fully scaffolded
    // here. Existing node states are preserved verbatim; missing ones are
    // scaffolded fresh. Any extra keys present in iteration.nodes but not in
    // the template body — e.g. a node scaffolded by walkNodes into the parent
    // iteration's nodes when a conditional branch is taken — are preserved
    // AFTER the body defs so their in-flight state is not clobbered on re-entry.
    const orderedNodes: Record<string, NodeState> = {};
    for (const bodyDef of fepDef.body) {
      orderedNodes[bodyDef.id] = iteration.nodes[bodyDef.id] ?? scaffoldNodeState(bodyDef);
    }
    for (const key of Object.keys(iteration.nodes)) {
      if (!(key in orderedNodes)) {
        orderedNodes[key] = iteration.nodes[key];
      }
    }
    iteration.nodes = orderedNodes;

    // Corrective path routing: walk corrective task nodes instead of body nodes
    if (iteration.corrective_tasks.length > 0) {
      const latestCorrective = iteration.corrective_tasks[iteration.corrective_tasks.length - 1];

      if (latestCorrective.status === NODE_STATUSES.HALTED) {
        return { action: NEXT_ACTIONS.DISPLAY_HALTED, context: { details: state.pipeline.halt_reason ?? 'Pipeline is halted' } };
      }

      if (latestCorrective.status === NODE_STATUSES.COMPLETED) {
        skipUnreachedIterationBodyNodes(iteration);
        iteration.status = NODE_STATUSES.COMPLETED;
        continue;
      }

      if (latestCorrective.status === NODE_STATUSES.NOT_STARTED) {
        latestCorrective.status = NODE_STATUSES.IN_PROGRESS;
      }

      // Derive correct body defs for corrective walking
      let correctiveBodyDefs: NodeDef[];
      if (fepDef.kind === 'for_each_phase') {
        const fetDef = fepDef.body.find((n) => n.kind === 'for_each_task') as ForEachTaskNodeDef | undefined;
        correctiveBodyDefs = fetDef ? fetDef.body : fepDef.body;
      } else {
        correctiveBodyDefs = fepDef.body;
      }

      const correctiveResult = walkNodes(correctiveBodyDefs, latestCorrective.nodes, config, state, readDocument, iteration);
      if (correctiveResult !== null) {
        return correctiveResult;
      }
      const allCorrectiveDone = correctiveBodyDefs.every((bn) => {
        const bnState = latestCorrective.nodes[bn.id];
        return (
          bnState !== undefined &&
          (bnState.status === NODE_STATUSES.COMPLETED ||
            bnState.status === NODE_STATUSES.SKIPPED)
        );
      });
      if (allCorrectiveDone) {
        latestCorrective.status = NODE_STATUSES.COMPLETED;
        skipUnreachedIterationBodyNodes(iteration);
        iteration.status = NODE_STATUSES.COMPLETED;
        continue;
      }
      return null;
    }

    const bodyResult = walkNodes(fepDef.body, iteration.nodes, config, state, readDocument, iteration);
    if (bodyResult !== null) {
      return bodyResult;
    }
    const allBodyDone = fepDef.body.every((bn) => {
      const bnState = iteration.nodes[bn.id];
      return (
        bnState !== undefined &&
        (bnState.status === NODE_STATUSES.COMPLETED ||
          bnState.status === NODE_STATUSES.SKIPPED)
      );
    });
    if (allBodyDone) {
      iteration.status = NODE_STATUSES.COMPLETED;
      continue;
    }
    return null;
  }
  return 'all_completed';
}

/**
 * Recursive helper that walks an array of node definitions against their
 * corresponding state entries. Returns the first actionable WalkerResult,
 * or null if no action is available at this level.
 */
function walkNodes(
  nodeDefs: NodeDef[],
  nodes: Record<string, NodeState>,
  config: OrchestrationConfig,
  state: PipelineState,
  readDocument?: (docPath: string) => { frontmatter: Record<string, unknown> } | null,
  currentIteration?: IterationEntry,
): WalkerResult | null {
  for (const nodeDef of nodeDefs) {
    const nodeState = nodes[nodeDef.id];
    if (!nodeState) {
      continue;
    }

    // Dependencies not met → skip to next sibling
    if (!checkDependencies(nodeDef.depends_on, nodes)) {
      continue;
    }

    // Status: halted → return display_halted
    if (nodeState.status === NODE_STATUSES.HALTED) {
      return { action: NEXT_ACTIONS.DISPLAY_HALTED, context: { details: state.pipeline.halt_reason ?? 'Pipeline is halted' } };
    }

    // Status: completed or skipped → continue to next sibling
    if (
      nodeState.status === NODE_STATUSES.COMPLETED ||
      nodeState.status === NODE_STATUSES.SKIPPED
    ) {
      continue;
    }

    // Status: in_progress
    if (nodeState.status === NODE_STATUSES.IN_PROGRESS) {
      // Conditional in_progress: walk taken branch
      if (nodeDef.kind === 'conditional') {
        const condDef = nodeDef as ConditionalNodeDef;
        const condState = nodeState as ConditionalNodeState;
        const branchKey = condState.branch_taken;
        if (branchKey === null) {
          return null;
        }
        const branchNodes = condDef.branches[branchKey];
        const allBranchDone = branchNodes.every((bn) => {
          const bnState = nodes[bn.id];
          return (
            bnState !== undefined &&
            (bnState.status === NODE_STATUSES.COMPLETED ||
              bnState.status === NODE_STATUSES.SKIPPED)
          );
        });
        if (allBranchDone) {
          condState.status = NODE_STATUSES.COMPLETED;
          continue;
        }
        return walkNodes(branchNodes, nodes, config, state, readDocument, currentIteration);
      }

      // Parallel in_progress: walk children sequentially
      if (nodeDef.kind === 'parallel') {
        const parallelDef = nodeDef as ParallelNodeDef;
        const parallelState = nodeState as ParallelNodeState;
        const allChildrenDone = parallelDef.children.every((child) => {
          const childState = parallelState.nodes[child.id];
          return (
            childState !== undefined &&
            (childState.status === NODE_STATUSES.COMPLETED ||
              childState.status === NODE_STATUSES.SKIPPED)
          );
        });
        if (allChildrenDone) {
          parallelState.status = NODE_STATUSES.COMPLETED;
          continue;
        }
        return walkNodes(parallelDef.children, parallelState.nodes, config, state, readDocument, currentIteration);
      }

      // for_each_phase in_progress: walk iterations sequentially
      if (nodeDef.kind === 'for_each_phase') {
        const fepDef = nodeDef as ForEachPhaseNodeDef;
        const fepState = nodeState as ForEachPhaseNodeState;

        const iterResult = walkForEachIterations(fepDef, fepState, config, state, readDocument);
        if (iterResult === 'all_completed') {
          fepState.status = NODE_STATUSES.COMPLETED;
          continue;
        }
        return iterResult;
      }

      // for_each_task in_progress: walk iterations sequentially
      if (nodeDef.kind === 'for_each_task') {
        const fetDef = nodeDef as ForEachTaskNodeDef;
        const fetState = nodeState as ForEachTaskNodeState;

        const iterResult = walkForEachIterations(fetDef, fetState, config, state, readDocument);
        if (iterResult === 'all_completed') {
          fetState.status = NODE_STATUSES.COMPLETED;
          continue;
        }
        return iterResult;
      }

      // Optimistic in_progress at action-return: keep the in_progress flag set
      // when re-emitting a step's action. Single source of truth for step
      // status writes (carries FR-10 / AD-2 from ACTION-EVENT-DATA-1).
      if (nodeDef.kind === 'step') {
        const stepDef = nodeDef as StepNodeDef;
        nodeState.status = NODE_STATUSES.IN_PROGRESS;
        return {
          action: stepDef.action,
          context: stepDef.context ?? {},
        };
      }

      // Gate in_progress → re-emit action_if_needed. Included for symmetry;
      // no current state-machine path transitions a gate to in_progress
      // (gates stay not_started until the *_approved event flips them to
      // completed), so this branch is defensive dead code today.
      if (nodeDef.kind === 'gate') {
        const gateDef = nodeDef as GateNodeDef;
        return {
          action: gateDef.action_if_needed,
          context: {},
        };
      }

      return null;
    }

    // Status: not_started
    if (nodeState.status === NODE_STATUSES.NOT_STARTED) {
      // Optimistic in_progress at action-return: flip a resolved step node
      // to in_progress on the same walk that returns its action (carries
      // FR-10 / AD-2 from ACTION-EVENT-DATA-1; previously written by the
      // post-walk helper in engine.ts, now walker-owned per AD-1).
      if (nodeDef.kind === 'step') {
        const stepDef = nodeDef as StepNodeDef;
        nodeState.status = NODE_STATUSES.IN_PROGRESS;
        return {
          action: stepDef.action,
          context: stepDef.context ?? {},
        };
      }

      // Gate node
      if (nodeDef.kind === 'gate') {
        const gateDef = nodeDef as GateNodeDef;
        const gateState = nodeState as GateNodeState;
        const configValue = resolveConfigValue(gateDef.mode_ref, config);

        // Boolean path: human gates (plan_approval_gate, final_approval_gate)
        if (typeof configValue === 'boolean') {
          if (!configValue) {
            gateState.status = NODE_STATUSES.COMPLETED;
            gateState.gate_active = false;
            continue;
          }
          gateState.gate_active = true;
          return {
            action: gateDef.action_if_needed,
            context: {},
          };
        }

        // Resolve effective mode: persisted runtime → config → 'ask' fallback
        const effectiveMode: string =
          state.pipeline.gate_mode ??
          (typeof configValue === 'string' ? configValue : 'ask');

        if (effectiveMode === 'ask' && state.pipeline.gate_mode === null) {
          return {
            action: NEXT_ACTIONS.ASK_GATE_MODE,
            context: {},
          };
        }

        // Unconditional auto-approve: effective mode in auto_approve_modes
        if (
          gateDef.auto_approve_modes &&
          gateDef.auto_approve_modes.includes(effectiveMode)
        ) {
          gateState.status = NODE_STATUSES.COMPLETED;
          gateState.gate_active = false;
          continue;
        }

        // Autonomous verdict check
        if (effectiveMode === 'autonomous') {
          const depId = gateDef.depends_on?.[0];
          if (depId && nodes[depId]) {
            const reviewState = nodes[depId] as StepNodeState;
            if (reviewState.verdict === 'approved') {
              gateState.status = NODE_STATUSES.COMPLETED;
              gateState.gate_active = false;
              continue;
            }
          }
          gateState.gate_active = true;
          return {
            action: gateDef.action_if_needed,
            context: {},
          };
        }

        // Default: show gate
        gateState.gate_active = true;
        return {
          action: gateDef.action_if_needed,
          context: {},
        };
      }

      // Conditional node
      if (nodeDef.kind === 'conditional') {
        const condDef = nodeDef as ConditionalNodeDef;
        const condState = nodeState as ConditionalNodeState;
        const condResult = evaluateCondition(condDef.condition, config, state);
        condState.branch_taken = condResult ? 'true' : 'false';
        const branchNodes = condDef.branches[condState.branch_taken];

        if (branchNodes.length === 0) {
          condState.status = NODE_STATUSES.COMPLETED;
          continue;
        }

        condState.status = NODE_STATUSES.IN_PROGRESS;
        for (const branchNode of branchNodes) {
          if (!(branchNode.id in nodes)) {
            nodes[branchNode.id] = scaffoldNodeState(branchNode);
          }
        }
        return walkNodes(branchNodes, nodes, config, state, readDocument, currentIteration);
      }

      // Parallel node
      if (nodeDef.kind === 'parallel') {
        const parallelDef = nodeDef as ParallelNodeDef;
        const parallelState = nodeState as ParallelNodeState;
        parallelState.status = NODE_STATUSES.IN_PROGRESS;
        for (const child of parallelDef.children) {
          if (!(child.id in parallelState.nodes)) {
            parallelState.nodes[child.id] = scaffoldNodeState(child);
          }
        }
        return walkNodes(parallelDef.children, parallelState.nodes, config, state, readDocument, currentIteration);
      }

      // for_each_phase node
      if (nodeDef.kind === 'for_each_phase') {
        const fepDef = nodeDef as ForEachPhaseNodeDef;
        const fepState = nodeState as ForEachPhaseNodeState;

        if (fepState.iterations.length === 0) {
          // Needs expansion — requires readDocument callback
          if (!readDocument) {
            return null;
          }

          // Resolve source_doc_ref to get the document path
          const docPath = resolveStateRef(fepDef.source_doc_ref, state.graph);
          if (typeof docPath !== 'string') {
            return null;
          }

          // Read the document to get total_field from frontmatter
          const doc = readDocument(docPath);
          if (!doc) {
            return null;
          }

          const totalValue = doc.frontmatter[fepDef.total_field];
          if (typeof totalValue !== 'number' || !Number.isInteger(totalValue) || totalValue <= 0) {
            return null;
          }

          // Pre-scaffold body nodes on walker-driven expansion. This keeps
          // the non-explosion (default.yml) flow consistent with existing
          // fixture expectations. Explosion-pre-seeded iterations take the
          // walkForEachIterations path, which also scaffolds missing body
          // nodes on first in_progress transition.
          for (let i = 0; i < totalValue; i++) {
            const iterationNodes: Record<string, NodeState> = {};
            for (const bodyDef of fepDef.body) {
              iterationNodes[bodyDef.id] = scaffoldNodeState(bodyDef);
            }
            fepState.iterations.push({
              index: i,
              status: NODE_STATUSES.NOT_STARTED,
              nodes: iterationNodes,
              corrective_tasks: [],
              repos: [],
            });
          }

        }

        // Container transitions to in_progress once we're about to walk into
        // iterations — whether they were just expanded or pre-seeded by the
        // explosion script.
        fepState.status = NODE_STATUSES.IN_PROGRESS;

        // Walk into first iteration (fall through to in_progress logic)
        const iterResult = walkForEachIterations(fepDef, fepState, config, state, readDocument);
        if (iterResult === 'all_completed') {
          fepState.status = NODE_STATUSES.COMPLETED;
          continue;
        }
        return iterResult;
      }

      // for_each_task node
      if (nodeDef.kind === 'for_each_task') {
        const fetDef = nodeDef as ForEachTaskNodeDef;
        const fetState = nodeState as ForEachTaskNodeState;

        if (fetState.iterations.length === 0) {
          // Needs expansion — requires readDocument callback
          if (!readDocument) {
            return null;
          }

          // Resolve source_doc_ref within the current scope. For
          // "$.current_phase.doc_path" the doc_path is read from the enclosing
          // phase iteration carried via currentIteration.
          const docPath = resolveDocRefInScope(fetDef.source_doc_ref, state.graph, currentIteration);
          if (typeof docPath !== 'string') {
            return null;
          }

          // Read the document to get the tasks array from frontmatter
          const doc = readDocument(docPath);
          if (!doc) {
            return null;
          }

          const tasksValue = doc.frontmatter[fetDef.tasks_field];
          if (!Array.isArray(tasksValue)) {
            return null;
          }

          if (tasksValue.length === 0) {
            // Zero tasks — complete immediately.
            fetState.status = NODE_STATUSES.COMPLETED;
            continue;
          }

          // Pre-scaffold body nodes on walker-driven expansion. See the
          // equivalent for_each_phase comment above.
          for (let i = 0; i < tasksValue.length; i++) {
            const iterationNodes: Record<string, NodeState> = {};
            for (const bodyDef of fetDef.body) {
              iterationNodes[bodyDef.id] = scaffoldNodeState(bodyDef);
            }
            fetState.iterations.push({
              index: i,
              status: NODE_STATUSES.NOT_STARTED,
              nodes: iterationNodes,
              corrective_tasks: [],
              repos: [],
            });
          }

        }

        // Container transitions to in_progress once we're about to walk into
        // iterations — whether they were just expanded or pre-seeded.
        fetState.status = NODE_STATUSES.IN_PROGRESS;

        // Walk into iterations
        const iterResult = walkForEachIterations(fetDef, fetState, config, state, readDocument);
        if (iterResult === 'all_completed') {
          fetState.status = NODE_STATUSES.COMPLETED;
          continue;
        }
        return iterResult;
      }

      return null;
    }
  }

  return null;
}

/**
 * Derives the current active node path from the `in_progress` markers in the
 * state tree, rather than from the echoed `current_node_path` field. This
 * resolves the stale-cursor problem during corrective execution where the
 * echoed path trails the markers.
 *
 * Returns the state-path string of the deepest in_progress leaf (e.g.,
 * "phase_loop[0].corrective_tasks[1]"), or null when no concrete active node
 * exists. A "concrete active node" is either:
 *   - a corrective task entry with status `in_progress`
 *   - a leaf step/gate node with status `in_progress`
 *
 * Container nodes (`for_each_phase`, `for_each_task`) that are `in_progress`
 * without any deeper in_progress descendant are **not** counted — they are in
 * a transitional state (mid-walker advancement) and treating them as active
 * would produce false-positive tripwire errors.
 *
 * FR-8, FR-9, AD-1
 */
export function deriveCurrentNodePathFromMarkers(state: PipelineState): string | null {
  const phaseLoop = state.graph.nodes['phase_loop'] as ForEachPhaseNodeState | undefined;
  if (!phaseLoop?.iterations?.length) return null;

  function findLeaf(nodes: Record<string, NodeState>, prefix: string): string | null {
    for (const [id, node] of Object.entries(nodes)) {
      const here = `${prefix}${id}`;
      if (node.status === 'in_progress') {
        if (node.kind === 'for_each_phase' || node.kind === 'for_each_task') {
          for (const iter of node.iterations) {
            for (const ct of iter.corrective_tasks) {
              if (ct.status === 'in_progress') {
                const deeper = findLeaf(ct.nodes, `${here}[${iter.index}].corrective_tasks[${ct.index}].`);
                if (deeper) return deeper;
                return `${here}[${iter.index}].corrective_tasks[${ct.index}]`;
              }
            }
            const deeper = findLeaf(iter.nodes, `${here}[${iter.index}].`);
            if (deeper) return deeper;
          }
          // Container is in_progress but no deeper leaf found — transitional, not concrete
          return null;
        }
        // Conditional routers are not concrete leaves: the taken-branch step is
        // scaffolded as a FLAT SIBLING in this same `nodes` record (see
        // walkNodes), so keep scanning to reach it rather than reporting the
        // router path as the cursor.
        if (node.kind === 'conditional') {
          continue;
        }
        // Parallel containers nest their children under `node.nodes`; descend to
        // find the concrete active leaf instead of reporting the container.
        if (node.kind === 'parallel') {
          const deeper = findLeaf(node.nodes, `${here}.`);
          if (deeper) return deeper;
          continue;
        }
        // Leaf node (step or gate) — this is the concrete active node
        return here;
      }
    }
    return null;
  }

  return findLeaf(state.graph.nodes, '');
}

/**
 * Core DAG traversal function. Walks template nodes in order using a recursive
 * helper, checking dependencies and node status to determine the next action.
 *
 * Handles `step`, `gate`, `conditional`, `parallel`, `for_each_phase`, and
 * `for_each_task` node kinds.
 */
export function walkDAG(
  state: PipelineState,
  template: PipelineTemplate,
  config: OrchestrationConfig,
  readDocument?: (docPath: string) => { frontmatter: Record<string, unknown> } | null,
): WalkerResult | null {
  if (state.graph.status === GRAPH_STATUSES.HALTED) {
    return {
      action: NEXT_ACTIONS.DISPLAY_HALTED,
      context: { details: state.pipeline.halt_reason ?? 'Pipeline is halted' },
    };
  }

  const result = walkNodes(template.nodes, state.graph.nodes, config, state, readDocument);
  if (result !== null) {
    return result;
  }

  // After iterating all nodes: check if all completed/skipped
  const allDone = template.nodes.every((nodeDef) => {
    const ns = state.graph.nodes[nodeDef.id];
    return (
      ns !== undefined &&
      (ns.status === NODE_STATUSES.COMPLETED ||
        ns.status === NODE_STATUSES.SKIPPED)
    );
  });

  if (allDone) {
    state.graph.status = GRAPH_STATUSES.COMPLETED;
    return { action: NEXT_ACTIONS.DISPLAY_COMPLETE, context: {} };
  }

  return null;
}
