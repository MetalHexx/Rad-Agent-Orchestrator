/**
 * Tests for SSE state_change sidebar-patching logic in use-projects hook.
 * Run with: npx tsx ui/hooks/use-projects.test.ts
 *
 * v5 and v6 states are structurally identical; the handler derives
 * planningStatus/executionStatus from the graph uniformly (for the sort
 * classifier) and only discriminates the reported schemaVersion. tier/state/
 * stateLabel are never derived here — they're copied verbatim from the
 * server-sent `payload.projectState`, mirroring ui/hooks/use-projects.ts.
 */
import assert from 'node:assert';

// Inline types matching ui/types/components.ts and ui/types/state.ts
type PipelineTier = 'planning' | 'execution' | 'review' | 'complete' | 'halted';
type V5PipelineTier = 'planning' | 'execution' | 'review' | 'halted';
type GraphStatus = 'not_started' | 'in_progress' | 'completed' | 'halted';
type PlanningStatus = 'not_started' | 'in_progress' | 'complete';
type ExecutionStatus = 'not_started' | 'in_progress' | 'complete' | 'halted';
type NodeStatus = 'not_started' | 'in_progress' | 'completed' | 'halted' | 'skipped';

// Inline mirror of @rad-orchestration/work-graph#ProjectState / DerivedProjectState
type ProjectState =
  | 'not_initialized' | 'not_started' | 'planning' | 'planned'
  | 'executing' | 'pending_review' | 'halted' | 'complete';
interface DerivedProjectState {
  tier: PipelineTier | null;
  state: ProjectState;
  label: string;
}

interface NodeState {
  status: NodeStatus;
  [key: string]: unknown;
}
type NodesRecord = Record<string, NodeState>;

interface ProjectSummary {
  name: string;
  tier: PipelineTier | 'not_initialized';
  state: ProjectState;
  stateLabel: string;
  hasState: boolean;
  hasMalformedState: boolean;
  errorMessage?: string;
  brainstormingDoc?: string | null;
  planningStatus?: PlanningStatus;
  executionStatus?: ExecutionStatus;
  lastUpdated?: string;
  schemaVersion?: 'v5' | 'v6';
  graphStatus?: GraphStatus | 'not_initialized';
}

// v5 state shape (minimal fields used by the handler)
interface V5State {
  $schema: 'orchestration-state-v5';
  pipeline: { current_tier: V5PipelineTier };
  graph: { status: GraphStatus; nodes: NodesRecord };
  project?: { name: string; created: string; updated: string };
}

// v6 state shape — structurally identical to v5, discriminated by $schema
interface V6State {
  $schema: 'orchestration-state-v6';
  pipeline: { current_tier: V5PipelineTier };
  graph: { status: GraphStatus; nodes: NodesRecord };
  project?: { name: string; created: string; updated: string };
}

type AnyState = V5State | V6State;

// Inline type guard matching ui/types/state.ts
function isV6State(state: AnyState): state is V6State {
  return state.$schema === 'orchestration-state-v6';
}

// Inline planning/execution derivation matching ui/lib/status-derivation.ts
const PLANNING_NODES = ['research', 'prd', 'design', 'architecture', 'master_plan'];

function derivePlanningStatus(nodes: NodesRecord): PlanningStatus {
  const statuses = PLANNING_NODES.map(id => nodes[id]?.status ?? 'not_started');
  if (statuses.every(s => s === 'completed')) return 'complete';
  if (statuses.some(s => s === 'in_progress')) return 'in_progress';
  return 'not_started';
}

const EXECUTION_NODES = ['phase_loop', 'final_review'];

function deriveExecutionStatus(graphStatus: GraphStatus, nodes: NodesRecord): ExecutionStatus {
  if (graphStatus === 'completed') return 'complete';
  if (graphStatus === 'halted') return 'halted';
  if (
    EXECUTION_NODES.some(id => nodes[id] && nodes[id].status === 'in_progress')
  ) {
    return 'in_progress';
  }
  return 'not_started';
}

// The uniform SSE state_change mapping logic replicated from
// ui/hooks/use-projects.ts. tier/state/stateLabel are copied verbatim from
// payload.projectState — this function computes none of them itself.
// planningStatus/executionStatus are still graph-derived, for the sort
// classifier only; v5 and v6 are handled identically there.
function applyStateChange(
  p: ProjectSummary,
  payload: { projectName: string; state: AnyState; projectState: DerivedProjectState }
): ProjectSummary {
  if (p.name !== payload.projectName) return p;
  const state = payload.state;
  return {
    ...p,
    tier: payload.projectState.tier ?? 'not_initialized',
    state: payload.projectState.state,
    stateLabel: payload.projectState.label,
    planningStatus: derivePlanningStatus(state.graph.nodes),
    executionStatus: deriveExecutionStatus(state.graph.status, state.graph.nodes),
    lastUpdated: state.project?.updated,
    schemaVersion: isV6State(state) ? 'v6' : 'v5',
    graphStatus: state.graph.status,
  };
}

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`  ✗ ${name}\n    ${msg}`);
    failed++;
  }
}

async function run() {
  console.log('use-projects — SSE state_change sidebar patching');

  await test('(d) matching project — lastUpdated equals payload.state.project.updated', async () => {
    const p: ProjectSummary = {
      name: 'test',
      tier: 'not_initialized',
      state: 'not_initialized',
      stateLabel: 'Not Initialized',
      hasState: false,
      hasMalformedState: false,
      lastUpdated: undefined,
    };
    const state: V5State = {
      $schema: 'orchestration-state-v5',
      pipeline: { current_tier: 'execution' },
      graph: { status: 'in_progress', nodes: {} },
      project: {
        name: 'test',
        created: '2026-01-01T00:00:00Z',
        updated: '2026-04-06T14:30:00.000Z',
      },
    };
    const projectState: DerivedProjectState = { tier: 'execution', state: 'pending_review', label: 'Pending Review' };
    const result = applyStateChange(p, { projectName: 'test', state, projectState });
    assert.strictEqual(result.lastUpdated, '2026-04-06T14:30:00.000Z');
  });

  await test('(e) non-matching project — original object returned unchanged', async () => {
    const p: ProjectSummary = {
      name: 'other-project',
      tier: 'planning',
      state: 'planning',
      stateLabel: 'Planning',
      hasState: true,
      hasMalformedState: false,
      lastUpdated: '2026-01-01T00:00:00.000Z',
    };
    const state: V5State = {
      $schema: 'orchestration-state-v5',
      pipeline: { current_tier: 'execution' },
      graph: { status: 'in_progress', nodes: {} },
      project: {
        name: 'test',
        created: '2026-01-01T00:00:00Z',
        updated: '2026-04-06T14:30:00.000Z',
      },
    };
    const projectState: DerivedProjectState = { tier: 'execution', state: 'pending_review', label: 'Pending Review' };
    const result = applyStateChange(p, { projectName: 'test', state, projectState });
    assert.strictEqual(result, p);
    assert.strictEqual(result.lastUpdated, '2026-01-01T00:00:00.000Z');
  });

  // v6 state — handled uniformly via graph derivation, labeled "v6"
  await test('(f) v6 state_change — schemaVersion is "v6", statuses graph-derived', async () => {
    const p: ProjectSummary = {
      name: 'proj',
      tier: 'not_initialized',
      state: 'not_initialized',
      stateLabel: 'Not Initialized',
      hasState: false,
      hasMalformedState: false,
    };
    const state: V6State = {
      $schema: 'orchestration-state-v6',
      pipeline: { current_tier: 'planning' },
      graph: {
        status: 'in_progress',
        nodes: {
          research: { status: 'in_progress' },
        },
      },
      project: { name: 'proj', created: '2026-01-01T00:00:00Z', updated: '2026-04-10T00:00:00Z' },
    };
    const projectState: DerivedProjectState = { tier: 'planning', state: 'planning', label: 'Planning' };
    const result = applyStateChange(p, { projectName: 'proj', state, projectState });
    assert.strictEqual(result.schemaVersion, 'v6');
    assert.strictEqual(result.tier, 'planning');
    assert.strictEqual(result.state, 'planning');
    assert.strictEqual(result.stateLabel, 'Planning');
    assert.strictEqual(result.planningStatus, 'in_progress');
    assert.strictEqual(result.executionStatus, 'not_started');
    assert.strictEqual(result.graphStatus, 'in_progress');
  });

  // v5 completed graph — tier/state become 'complete'
  await test('(g) v5 state_change with completed graph — tier/state are "complete", schemaVersion is "v5"', async () => {
    const p: ProjectSummary = {
      name: 'proj',
      tier: 'not_initialized',
      state: 'not_initialized',
      stateLabel: 'Not Initialized',
      hasState: false,
      hasMalformedState: false,
    };
    const state: V5State = {
      $schema: 'orchestration-state-v5',
      pipeline: { current_tier: 'execution' },
      graph: {
        status: 'completed',
        nodes: {
          research:     { status: 'completed' },
          prd:          { status: 'completed' },
          design:       { status: 'completed' },
          architecture: { status: 'completed' },
          master_plan:  { status: 'completed' },
          phase_loop:   { status: 'completed' },
        },
      },
      project: { name: 'proj', created: '2026-01-01T00:00:00Z', updated: '2026-04-12T10:00:00Z' },
    };
    const projectState: DerivedProjectState = { tier: 'complete', state: 'complete', label: 'Complete' };
    const result = applyStateChange(p, { projectName: 'proj', state, projectState });
    assert.strictEqual(result.schemaVersion, 'v5');
    assert.strictEqual(result.tier, 'complete');
    assert.strictEqual(result.state, 'complete');
    assert.strictEqual(result.stateLabel, 'Complete');
    assert.strictEqual(result.planningStatus, 'complete');
    assert.strictEqual(result.executionStatus, 'complete');
    assert.strictEqual(result.lastUpdated, '2026-04-12T10:00:00Z');
  });

  // v5 in-progress graph — tier/state from the server-sent projectState
  await test('(h) v5 state_change with in-progress graph — tier/state from projectState, schemaVersion is "v5"', async () => {
    const p: ProjectSummary = {
      name: 'proj',
      tier: 'not_initialized',
      state: 'not_initialized',
      stateLabel: 'Not Initialized',
      hasState: false,
      hasMalformedState: false,
    };
    const state: V5State = {
      $schema: 'orchestration-state-v5',
      pipeline: { current_tier: 'execution' },
      graph: {
        status: 'in_progress',
        nodes: {
          research:     { status: 'completed' },
          prd:          { status: 'completed' },
          design:       { status: 'completed' },
          architecture: { status: 'completed' },
          master_plan:  { status: 'completed' },
          phase_loop:   { status: 'in_progress' },
        },
      },
      project: { name: 'proj', created: '2026-01-01T00:00:00Z', updated: '2026-04-12T11:00:00Z' },
    };
    const projectState: DerivedProjectState = { tier: 'execution', state: 'executing', label: 'Executing' };
    const result = applyStateChange(p, { projectName: 'proj', state, projectState });
    assert.strictEqual(result.schemaVersion, 'v5');
    assert.strictEqual(result.tier, 'execution');
    assert.strictEqual(result.state, 'executing');
    assert.strictEqual(result.stateLabel, 'Executing');
    assert.strictEqual(result.planningStatus, 'complete');
    assert.strictEqual(result.executionStatus, 'in_progress');
    assert.strictEqual(result.lastUpdated, '2026-04-12T11:00:00Z');
  });

  // v5 non-matching project — returned unchanged
  await test('(i) v5 state_change for non-matching project — original ProjectSummary returned unchanged', async () => {
    const p: ProjectSummary = {
      name: 'other-proj',
      tier: 'planning',
      state: 'planning',
      stateLabel: 'Planning',
      hasState: true,
      hasMalformedState: false,
      lastUpdated: '2026-01-01T00:00:00Z',
    };
    const state: V5State = {
      $schema: 'orchestration-state-v5',
      pipeline: { current_tier: 'execution' },
      graph: { status: 'in_progress', nodes: {} },
    };
    const projectState: DerivedProjectState = { tier: 'execution', state: 'pending_review', label: 'Pending Review' };
    const result = applyStateChange(p, { projectName: 'proj', state, projectState });
    assert.strictEqual(result, p);
    assert.strictEqual(result.lastUpdated, '2026-01-01T00:00:00Z');
  });

  // graphStatus tests
  await test('(j) v5 state_change — graphStatus mirrors payload graph.status (in_progress)', async () => {
    const p: ProjectSummary = {
      name: 'proj',
      tier: 'not_initialized',
      state: 'not_initialized',
      stateLabel: 'Not Initialized',
      hasState: false,
      hasMalformedState: false,
    };
    const state: V5State = {
      $schema: 'orchestration-state-v5',
      pipeline: { current_tier: 'execution' },
      graph: {
        status: 'in_progress',
        nodes: {
          research:     { status: 'completed' },
          prd:          { status: 'completed' },
          design:       { status: 'completed' },
          architecture: { status: 'completed' },
          master_plan:  { status: 'completed' },
          phase_loop:   { status: 'in_progress' },
        },
      },
      project: { name: 'proj', created: '2026-01-01T00:00:00Z', updated: '2026-04-16T00:00:00Z' },
    };
    const projectState: DerivedProjectState = { tier: 'execution', state: 'executing', label: 'Executing' };
    const result = applyStateChange(p, { projectName: 'proj', state, projectState });
    assert.strictEqual(result.graphStatus, 'in_progress');
  });

  await test('(k) v5 state_change — graphStatus mirrors payload graph.status (completed)', async () => {
    const p: ProjectSummary = {
      name: 'proj',
      tier: 'not_initialized',
      state: 'not_initialized',
      stateLabel: 'Not Initialized',
      hasState: false,
      hasMalformedState: false,
    };
    const state: V5State = {
      $schema: 'orchestration-state-v5',
      pipeline: { current_tier: 'execution' },
      graph: {
        status: 'completed',
        nodes: {
          research:     { status: 'completed' },
          prd:          { status: 'completed' },
          design:       { status: 'completed' },
          architecture: { status: 'completed' },
          master_plan:  { status: 'completed' },
          phase_loop:   { status: 'completed' },
          final_review: { status: 'completed' },
        },
      },
      project: { name: 'proj', created: '2026-01-01T00:00:00Z', updated: '2026-04-16T00:00:00Z' },
    };
    const projectState: DerivedProjectState = { tier: 'complete', state: 'complete', label: 'Complete' };
    const result = applyStateChange(p, { projectName: 'proj', state, projectState });
    assert.strictEqual(result.graphStatus, 'completed');
  });

  await test('(l) v6 state_change — graphStatus mirrors payload graph.status', async () => {
    const p: ProjectSummary = {
      name: 'proj',
      tier: 'not_initialized',
      state: 'not_initialized',
      stateLabel: 'Not Initialized',
      hasState: false,
      hasMalformedState: false,
    };
    const state: V6State = {
      $schema: 'orchestration-state-v6',
      pipeline: { current_tier: 'planning' },
      graph: { status: 'in_progress', nodes: { research: { status: 'in_progress' } } },
      project: { name: 'proj', created: '2026-01-01T00:00:00Z', updated: '2026-04-16T00:00:00Z' },
    };
    const projectState: DerivedProjectState = { tier: 'planning', state: 'planning', label: 'Planning' };
    const result = applyStateChange(p, { projectName: 'proj', state, projectState });
    assert.strictEqual(result.graphStatus, 'in_progress');
    assert.strictEqual(result.schemaVersion, 'v6');
  });

  // The seam to get right: the hook must never reconstruct tier/state/label
  // from `payload.state` itself — it only ever copies `payload.projectState`.
  await test('(m) payload.projectState lands on the summary verbatim, even when it disagrees with payload.state — the hook derives no label of its own', async () => {
    const p: ProjectSummary = {
      name: 'proj',
      tier: 'not_initialized',
      state: 'not_initialized',
      stateLabel: 'Not Initialized',
      hasState: false,
      hasMalformedState: false,
    };
    const state: V5State = {
      $schema: 'orchestration-state-v5',
      pipeline: { current_tier: 'execution' },
      graph: { status: 'in_progress', nodes: { phase_loop: { status: 'in_progress' } } },
      project: { name: 'proj', created: '2026-01-01T00:00:00Z', updated: '2026-05-01T00:00:00Z' },
    };
    // Deliberately NOT what deriving from `state` above would produce
    // ('execution'/'executing') — proves the hook patches verbatim rather
    // than recomputing from payload.state.
    const projectState: DerivedProjectState = { tier: 'review', state: 'halted', label: 'Halted' };
    const result = applyStateChange(p, { projectName: 'proj', state, projectState });
    assert.strictEqual(result.tier, 'review');
    assert.strictEqual(result.state, 'halted');
    assert.strictEqual(result.stateLabel, 'Halted');
  });

  await test('(n) payload.projectState.tier === null maps to "not_initialized" on the summary', async () => {
    const p: ProjectSummary = {
      name: 'proj',
      tier: 'execution',
      state: 'executing',
      stateLabel: 'Executing',
      hasState: true,
      hasMalformedState: false,
    };
    const state: V5State = {
      $schema: 'orchestration-state-v5',
      pipeline: { current_tier: 'execution' },
      graph: { status: 'not_started', nodes: {} },
      project: { name: 'proj', created: '2026-01-01T00:00:00Z', updated: '2026-05-02T00:00:00Z' },
    };
    const projectState: DerivedProjectState = { tier: null, state: 'not_started', label: 'Not Started' };
    const result = applyStateChange(p, { projectName: 'proj', state, projectState });
    assert.strictEqual(result.tier, 'not_initialized');
    assert.strictEqual(result.state, 'not_started');
    assert.strictEqual(result.stateLabel, 'Not Started');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run();
