/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYamlRaw } from 'yaml';
import { parseTemplateToGraph, serializeGraphToYaml } from './template-serializer';

// ── Fixture loading ───────────────────────────────────────────────────────────

const EXTRA_HIGH_YAML = readFileSync(
  join(__dirname, '../../runtime-config/templates/extra-high.yml'),
  'utf-8'
);

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Recursively find a node by id in a (possibly nested) YAML nodes array. */
function findYamlNode(nodes: any[], id: string): any | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (Array.isArray(node.body)) {
      const found = findYamlNode(node.body, id);
      if (found) return found;
    }
    if (node.branches) {
      const trueBranch = node.branches['true'];
      if (Array.isArray(trueBranch)) {
        const found = findYamlNode(trueBranch, id);
        if (found) return found;
      }
      const falseBranch = node.branches['false'];
      if (Array.isArray(falseBranch)) {
        const found = findYamlNode(falseBranch, id);
        if (found) return found;
      }
    }
  }
  return undefined;
}

// ── parseTemplateToGraph ──────────────────────────────────────────────────────

describe('parseTemplateToGraph', () => {
  it('parsing extra-high.yml produces a TemplateGraph with nodes and edges arrays', () => {
    const graph = parseTemplateToGraph(EXTRA_HIGH_YAML);
    assert.ok(Array.isArray(graph.nodes), 'nodes should be an array');
    assert.ok(Array.isArray(graph.edges), 'edges should be an array');
    assert.ok(graph.nodes.length > 0, 'nodes should not be empty');
  });

  it('all five node kinds appear in parsed extra-high.yml nodes', () => {
    const graph = parseTemplateToGraph(EXTRA_HIGH_YAML);
    const kinds = new Set(graph.nodes.map(n => n.data.kind));
    assert.ok(kinds.has('step'), 'kind "step" not found');
    assert.ok(kinds.has('gate'), 'kind "gate" not found');
    assert.ok(kinds.has('conditional'), 'kind "conditional" not found');
    assert.ok(kinds.has('for_each_phase'), 'kind "for_each_phase" not found');
    assert.ok(kinds.has('for_each_task'), 'kind "for_each_task" not found');
  });

  it('loop nodes (for_each_phase, for_each_task) have type: templateGroup', () => {
    const graph = parseTemplateToGraph(EXTRA_HIGH_YAML);
    const loopNodes = graph.nodes.filter(
      n => n.data.kind === 'for_each_phase' || n.data.kind === 'for_each_task'
    );
    assert.ok(loopNodes.length > 0, 'no loop nodes found');
    for (const n of loopNodes) {
      assert.strictEqual(n.type, 'templateGroup', `loop node ${n.id} should be templateGroup`);
    }
  });

  it('step and gate nodes have type: templateNode', () => {
    const graph = parseTemplateToGraph(EXTRA_HIGH_YAML);
    const nodes = graph.nodes.filter(n => n.data.kind === 'step' || n.data.kind === 'gate');
    assert.ok(nodes.length > 0, 'no step/gate nodes found');
    for (const n of nodes) {
      assert.strictEqual(n.type, 'templateNode', `${n.id} should have type templateNode`);
    }
  });

  it('conditional nodes with non-empty branches have type: templateGroup', () => {
    const graph = parseTemplateToGraph(EXTRA_HIGH_YAML);
    const nodes = graph.nodes.filter(n => n.data.kind === 'conditional');
    assert.ok(nodes.length > 0, 'no conditional nodes found');
    for (const n of nodes) {
      assert.strictEqual(n.type, 'templateGroup', `${n.id} should have type templateGroup`);
    }
  });

  it('child nodes inside loop bodies have parentId set to the loop node id', () => {
    const graph = parseTemplateToGraph(EXTRA_HIGH_YAML);
    const phaseLoopChildren = graph.nodes.filter(n => n.parentId === 'phase_loop');
    assert.ok(phaseLoopChildren.length > 0, 'phase_loop has no children');
    const childIds = phaseLoopChildren.map(n => n.id);
    assert.ok(childIds.includes('task_loop'), 'task_loop should be child of phase_loop');
    // Post-Iter 8: phase_report body node removed (phase_review absorbed phase_report);
    // phase_review is the remaining post-task-loop step body node.
    assert.ok(childIds.includes('phase_review'), 'phase_review should be child of phase_loop');
  });

  it('child nodes inside conditional branches have parentId set to the conditional node id', () => {
    const graph = parseTemplateToGraph(EXTRA_HIGH_YAML);
    const finalPrNode = graph.nodes.find(n => n.id === 'final_pr');
    assert.ok(finalPrNode, 'final_pr node not found');
    assert.strictEqual(
      finalPrNode.parentId,
      'pr_gate',
      'final_pr should have parentId: pr_gate'
    );
  });

  it('depends_on relationships become edges: source=dependency, target=dependent', () => {
    const graph = parseTemplateToGraph(EXTRA_HIGH_YAML);
    // plan_approval_gate depends on explode_master_plan (extra-high.yml structure)
    const edge = graph.edges.find(
      e => e.source === 'explode_master_plan' && e.target === 'plan_approval_gate'
    );
    assert.ok(edge, 'edge explode_master_plan → plan_approval_gate not found');
  });

  it('conditional branch edges have label: "true" for true-branch children', () => {
    const graph = parseTemplateToGraph(EXTRA_HIGH_YAML);
    const prTrueEdge = graph.edges.find(
      e => e.source === 'pr_gate' && e.target === 'final_pr' && e.label === 'true'
    );
    assert.ok(prTrueEdge, 'pr_gate → final_pr (true) edge not found');
  });

  it('all edges have type: smoothstep, markerEnd: { type: arrowclosed }, and animated: false', () => {
    const graph = parseTemplateToGraph(EXTRA_HIGH_YAML);
    assert.ok(graph.edges.length > 0, 'no edges produced');
    for (const edge of graph.edges) {
      assert.strictEqual(edge.type, 'smoothstep', `edge ${edge.id} type should be smoothstep`);
      assert.deepStrictEqual(
        edge.markerEnd,
        { type: 'arrowclosed' },
        `edge ${edge.id} markerEnd mismatch`
      );
      assert.strictEqual(edge.animated, false, `edge ${edge.id} animated should be false`);
    }
  });

  it('throws on invalid YAML input (empty string)', () => {
    assert.throws(() => parseTemplateToGraph(''));
  });

  it('throws on YAML without nodes array', () => {
    assert.throws(
      () => parseTemplateToGraph('template:\n  id: test\n'),
      /invalid template/i
    );
  });

  it('conditional node with empty branches has type: templateNode', () => {
    const yaml = [
      'template:',
      '  id: test-empty-cond',
      '  version: "1.0"',
      '  description: test',
      'nodes:',
      '  - id: check',
      '    kind: conditional',
      '    label: Check',
      '    depends_on: []',
      '    branches: {}',
    ].join('\n');
    const graph = parseTemplateToGraph(yaml);
    const node = graph.nodes.find((n) => n.id === 'check');
    assert.ok(node, 'conditional node not found');
    assert.strictEqual(node.type, 'templateNode', 'conditional with no branch children should be templateNode');
  });
});

// ── serializeGraphToYaml ──────────────────────────────────────────────────────

describe('serializeGraphToYaml', () => {
  it('serializing extra-high.yml graph produces valid parseable YAML', () => {
    const graph = parseTemplateToGraph(EXTRA_HIGH_YAML);
    const fullMeta = (parseYamlRaw(EXTRA_HIGH_YAML) as any).template;
    const serialized = serializeGraphToYaml(graph, fullMeta);
    assert.ok(typeof serialized === 'string' && serialized.length > 0);
    const reparsed = parseYamlRaw(serialized);
    assert.ok(reparsed !== null && typeof reparsed === 'object');
  });

  it('serialized output includes template metadata block (id, version, description)', () => {
    const graph = parseTemplateToGraph(EXTRA_HIGH_YAML);
    const fullMeta = (parseYamlRaw(EXTRA_HIGH_YAML) as any).template;
    const serialized = serializeGraphToYaml(graph, fullMeta);
    const reparsed = parseYamlRaw(serialized) as any;
    assert.ok(reparsed.template, 'template block missing from serialized output');
    assert.strictEqual(reparsed.template.id, fullMeta.id);
    assert.strictEqual(reparsed.template.version, fullMeta.version);
    assert.strictEqual(reparsed.template.description, fullMeta.description);
  });

  it('serialized output contains a non-empty nodes array', () => {
    const graph = parseTemplateToGraph(EXTRA_HIGH_YAML);
    const fullMeta = (parseYamlRaw(EXTRA_HIGH_YAML) as any).template;
    const serialized = serializeGraphToYaml(graph, fullMeta);
    const reparsed = parseYamlRaw(serialized) as any;
    assert.ok(Array.isArray(reparsed.nodes), 'nodes should be an array');
    assert.ok(reparsed.nodes.length > 0, 'nodes should not be empty');
  });
});

// ── round-trip fidelity ───────────────────────────────────────────────────────

describe('round-trip fidelity', () => {
  it('extra-high.yml round-trip: parse → serialize → re-parse deepStrictEquals original parse', () => {
    const graph = parseTemplateToGraph(EXTRA_HIGH_YAML);
    const fullMeta = (parseYamlRaw(EXTRA_HIGH_YAML) as any).template;
    const serialized = serializeGraphToYaml(graph, fullMeta);
    const original = parseYamlRaw(EXTRA_HIGH_YAML) as any;
    const roundTripped = parseYamlRaw(serialized);
    // Serializer only preserves id/version/description on template metadata;
    // fields like `status` are not round-tripped, so strip them before comparing.
    delete original.template.status;
    assert.deepStrictEqual(roundTripped, original);
  });

  it('double round-trip: parse → serialize → parse → serialize produces idempotent output', () => {
    const fullMeta = (parseYamlRaw(EXTRA_HIGH_YAML) as any).template;
    const graph1 = parseTemplateToGraph(EXTRA_HIGH_YAML);
    const serialized1 = serializeGraphToYaml(graph1, fullMeta);
    const graph2 = parseTemplateToGraph(serialized1);
    const serialized2 = serializeGraphToYaml(graph2, fullMeta);
    assert.deepStrictEqual(parseYamlRaw(serialized2), parseYamlRaw(serialized1));
  });

  it('node count preservation: re-parsed graph has the same number of nodes and edges', () => {
    const graph = parseTemplateToGraph(EXTRA_HIGH_YAML);
    const fullMeta = (parseYamlRaw(EXTRA_HIGH_YAML) as any).template;
    const serialized = serializeGraphToYaml(graph, fullMeta);
    const graph2 = parseTemplateToGraph(serialized);
    assert.strictEqual(graph2.nodes.length, graph.nodes.length, 'node count should be preserved');
    assert.strictEqual(graph2.edges.length, graph.edges.length, 'edge count should be preserved');
  });

  it('branchless conditional round-trip: no branches key emitted when conditional has no children', () => {
    const yaml = [
      'template:',
      '  id: test-branchless',
      '  version: "1.0"',
      '  description: branchless conditional round-trip',
      'nodes:',
      '  - id: check',
      '    kind: conditional',
      '    label: Check',
      '    depends_on: []',
    ].join('\n');
    const meta = (parseYamlRaw(yaml) as any).template;
    const graph = parseTemplateToGraph(yaml);
    const serialized = serializeGraphToYaml(graph, meta);
    const reparsed = parseYamlRaw(serialized) as any;
    const checkNode = reparsed.nodes.find((n: any) => n.id === 'check');
    assert.ok(checkNode, 'check node not found in serialized output');
    assert.strictEqual(
      checkNode.branches,
      undefined,
      'branchless conditional should NOT have a branches key in serialized output'
    );
  });
});

// ── node kind coverage ────────────────────────────────────────────────────────

describe('node kind coverage', () => {
  it('step nodes: master_plan has kind=step with meta fields action, events, doc_output_field', () => {
    const graph = parseTemplateToGraph(EXTRA_HIGH_YAML);
    const masterPlan = graph.nodes.find(n => n.id === 'master_plan');
    assert.ok(masterPlan, 'master_plan node not found');
    assert.strictEqual(masterPlan.data.kind, 'step');
    assert.ok('action' in masterPlan.data.meta, 'meta.action missing');
    assert.ok('events' in masterPlan.data.meta, 'meta.events missing');
    assert.ok('doc_output_field' in masterPlan.data.meta, 'meta.doc_output_field missing');
  });

  it('gate nodes: plan_approval_gate has kind=gate with meta fields mode_ref, action_if_needed, approved_event', () => {
    const graph = parseTemplateToGraph(EXTRA_HIGH_YAML);
    const gate = graph.nodes.find(n => n.id === 'plan_approval_gate');
    assert.ok(gate, 'plan_approval_gate node not found');
    assert.strictEqual(gate.data.kind, 'gate');
    assert.ok('mode_ref' in gate.data.meta, 'meta.mode_ref missing');
    assert.ok('action_if_needed' in gate.data.meta, 'meta.action_if_needed missing');
    assert.ok('approved_event' in gate.data.meta, 'meta.approved_event missing');
  });

  it('conditional nodes: pr_gate has kind=conditional, meta.condition is parseable JSON with state_ref/operator/value', () => {
    const graph = parseTemplateToGraph(EXTRA_HIGH_YAML);
    const cond = graph.nodes.find(n => n.id === 'pr_gate');
    assert.ok(cond, 'pr_gate node not found');
    assert.strictEqual(cond.data.kind, 'conditional');
    assert.ok('condition' in cond.data.meta, 'meta.condition missing');
    const condValue = JSON.parse(cond.data.meta.condition);
    assert.ok(condValue.state_ref, 'condition.state_ref missing');
    assert.ok(condValue.operator, 'condition.operator missing');
    assert.ok(condValue.value !== undefined, 'condition.value missing');
  });

  it('for_each_phase nodes: phase_loop has kind=for_each_phase, type=templateGroup, meta has source_doc_ref and total_field', () => {
    const graph = parseTemplateToGraph(EXTRA_HIGH_YAML);
    const loopNode = graph.nodes.find(n => n.id === 'phase_loop');
    assert.ok(loopNode, 'phase_loop node not found');
    assert.strictEqual(loopNode.data.kind, 'for_each_phase');
    assert.strictEqual(loopNode.type, 'templateGroup');
    assert.ok('source_doc_ref' in loopNode.data.meta, 'meta.source_doc_ref missing');
    assert.ok('total_field' in loopNode.data.meta, 'meta.total_field missing');
  });

  it('for_each_task nodes: task_loop has kind=for_each_task, type=templateGroup, meta has source_doc_ref and tasks_field', () => {
    const graph = parseTemplateToGraph(EXTRA_HIGH_YAML);
    const loopNode = graph.nodes.find(n => n.id === 'task_loop');
    assert.ok(loopNode, 'task_loop node not found');
    assert.strictEqual(loopNode.data.kind, 'for_each_task');
    assert.strictEqual(loopNode.type, 'templateGroup');
    assert.ok('source_doc_ref' in loopNode.data.meta, 'meta.source_doc_ref missing');
    assert.ok('tasks_field' in loopNode.data.meta, 'meta.tasks_field missing');
  });
});

// ── recursive nesting ─────────────────────────────────────────────────────────

describe('recursive nesting', () => {
  it('task_loop (for_each_task) has parentId: phase_loop', () => {
    const graph = parseTemplateToGraph(EXTRA_HIGH_YAML);
    const taskLoop = graph.nodes.find(n => n.id === 'task_loop');
    assert.ok(taskLoop, 'task_loop not found');
    assert.strictEqual(taskLoop.parentId, 'phase_loop');
  });

  it('nodes inside task_loop body (task_executor, code_review, task_gate) have parentId: task_loop', () => {
    const graph = parseTemplateToGraph(EXTRA_HIGH_YAML);
    for (const id of ['task_executor', 'code_review', 'task_gate']) {
      const node = graph.nodes.find(n => n.id === id);
      assert.ok(node, `${id} not found`);
      assert.strictEqual(node.parentId, 'task_loop', `${id} should have parentId: task_loop`);
    }
  });

  it('round-trip preserves nested body arrays and branches structure', () => {
    const graph = parseTemplateToGraph(EXTRA_HIGH_YAML);
    const fullMeta = (parseYamlRaw(EXTRA_HIGH_YAML) as any).template;
    const serialized = serializeGraphToYaml(graph, fullMeta);
    const reparsed = parseYamlRaw(serialized) as any;

    // phase_loop body exists and contains task_loop
    const phaseLoopReparsed = findYamlNode(reparsed.nodes, 'phase_loop');
    assert.ok(phaseLoopReparsed, 'phase_loop not found in re-parsed YAML');
    assert.ok(Array.isArray(phaseLoopReparsed.body), 'phase_loop.body should be an array');

    // task_loop nested inside phase_loop body, with its own body array
    const taskLoopReparsed = findYamlNode(phaseLoopReparsed.body, 'task_loop');
    assert.ok(taskLoopReparsed, 'task_loop not found in phase_loop.body');
    assert.ok(Array.isArray(taskLoopReparsed.body), 'task_loop.body should be an array');
    assert.ok(
      findYamlNode(taskLoopReparsed.body, 'code_review'),
      'code_review not found in task_loop.body'
    );

    // pr_gate (conditional) round-trips with its branches structure intact
    const prGateReparsed = findYamlNode(reparsed.nodes, 'pr_gate');
    assert.ok(prGateReparsed, 'pr_gate not found in re-parsed YAML');
    assert.ok(prGateReparsed.branches, 'pr_gate should have branches');
    assert.ok(
      Array.isArray(prGateReparsed.branches['true']),
      'pr_gate.branches.true should be an array'
    );
  });
});

// ── depends_on ↔ edges round-trip ────────────────────────────────────────────

describe('depends_on ↔ edges round-trip', () => {
  it('plan_approval_gate depends on explode_master_plan → edge { source: explode_master_plan, target: plan_approval_gate } exists', () => {
    const graph = parseTemplateToGraph(EXTRA_HIGH_YAML);
    const edge = graph.edges.find(
      e => e.source === 'explode_master_plan' && e.target === 'plan_approval_gate'
    );
    assert.ok(edge, 'edge explode_master_plan → plan_approval_gate not found');
  });

  it('task_gate depends on code_review → one unlabeled edge exists', () => {
    // task_gate.depends_on is ['code_review'], so the round-trip yields a single
    // unlabeled code_review → task_gate edge.
    const graph = parseTemplateToGraph(EXTRA_HIGH_YAML);
    const edge = graph.edges.find(
      e => e.source === 'code_review' && e.target === 'task_gate' && e.label === undefined
    );
    assert.ok(edge, 'edge code_review → task_gate not found');
  });

  it('after round-trip, depends_on arrays in re-parsed YAML match originals', () => {
    const graph = parseTemplateToGraph(EXTRA_HIGH_YAML);
    const fullMeta = (parseYamlRaw(EXTRA_HIGH_YAML) as any).template;
    const serialized = serializeGraphToYaml(graph, fullMeta);
    const reparsed = parseYamlRaw(serialized) as any;

    // Prior to iter-3 this asserted on `architecture` (depends_on: ['design']),
    // but the iter-3 template refactor removed the architecture node. The
    // replacement gate_mode_selection exercises the same round-trip contract:
    // a top-level node whose depends_on is a single-element array of strings.
    const gateModeSelection = findYamlNode(reparsed.nodes, 'gate_mode_selection');
    assert.ok(gateModeSelection, 'gate_mode_selection not found in re-parsed YAML');
    assert.deepStrictEqual(gateModeSelection.depends_on, ['plan_approval_gate']);

    // task_gate.depends_on should be ['code_review'].
    const taskGate = findYamlNode(reparsed.nodes, 'task_gate');
    assert.ok(taskGate, 'task_gate not found in re-parsed YAML');
    assert.deepStrictEqual(taskGate.depends_on, ['code_review']);
  });
});

// ── meta field round-trip ─────────────────────────────────────────────────────

describe('meta field round-trip', () => {
  it('step node events (object value) is stored as JSON string in meta and restores correctly after round-trip', () => {
    const graph = parseTemplateToGraph(EXTRA_HIGH_YAML);
    const masterPlan = graph.nodes.find(n => n.id === 'master_plan');
    assert.ok(masterPlan, 'master_plan node not found');
    // meta.events should be a JSON-encoded string
    assert.strictEqual(typeof masterPlan.data.meta.events, 'string', 'meta.events should be a string');
    const eventsObj = JSON.parse(masterPlan.data.meta.events);
    // master_plan in extra-high.yml emits a single completion event (no `started`).
    assert.deepStrictEqual(eventsObj, { completed: 'master_plan_completed' }, 'events object should round-trip from meta JSON');

    // After round-trip, events should be restored as object in YAML
    const fullMeta = (parseYamlRaw(EXTRA_HIGH_YAML) as any).template;
    const serialized = serializeGraphToYaml(graph, fullMeta);
    const reparsed = parseYamlRaw(serialized) as any;
    const masterPlanReparsed = findYamlNode(reparsed.nodes, 'master_plan');
    assert.ok(masterPlanReparsed, 'master_plan not found in re-parsed YAML');
    assert.deepStrictEqual(masterPlanReparsed.events, eventsObj);
  });

  it('gate node auto_approve_modes (array value) survives round-trip', () => {
    const graph = parseTemplateToGraph(EXTRA_HIGH_YAML);
    const gateMode = graph.nodes.find(n => n.id === 'gate_mode_selection');
    assert.ok(gateMode, 'gate_mode_selection not found');
    const modesArr = JSON.parse(gateMode.data.meta.auto_approve_modes);
    assert.deepStrictEqual(modesArr, ['task', 'phase', 'autonomous']);

    // After round-trip, array should be preserved
    const fullMeta = (parseYamlRaw(EXTRA_HIGH_YAML) as any).template;
    const serialized = serializeGraphToYaml(graph, fullMeta);
    const reparsed = parseYamlRaw(serialized) as any;
    const gateModeReparsed = findYamlNode(reparsed.nodes, 'gate_mode_selection');
    assert.ok(gateModeReparsed, 'gate_mode_selection not found in re-parsed YAML');
    assert.deepStrictEqual(gateModeReparsed.auto_approve_modes, ['task', 'phase', 'autonomous']);
  });

  it('conditional node condition (nested object) survives round-trip with state_ref, operator, value', () => {
    const graph = parseTemplateToGraph(EXTRA_HIGH_YAML);
    const prGate = graph.nodes.find(n => n.id === 'pr_gate');
    assert.ok(prGate, 'pr_gate not found');
    const condition = JSON.parse(prGate.data.meta.condition);
    assert.strictEqual(condition.state_ref, 'pipeline.source_control.auto_pr');
    assert.strictEqual(condition.operator, 'neq');
    assert.strictEqual(condition.value, 'never');

    // After round-trip, condition should be preserved as object
    const fullMeta = (parseYamlRaw(EXTRA_HIGH_YAML) as any).template;
    const serialized = serializeGraphToYaml(graph, fullMeta);
    const reparsed = parseYamlRaw(serialized) as any;
    const prGateReparsed = findYamlNode(reparsed.nodes, 'pr_gate');
    assert.ok(prGateReparsed, 'pr_gate not found in re-parsed YAML');
    assert.deepStrictEqual(prGateReparsed.condition, condition);
  });

  it('loop node source_doc_ref (string value) survives round-trip', () => {
    const graph = parseTemplateToGraph(EXTRA_HIGH_YAML);
    const phaseLoop = graph.nodes.find(n => n.id === 'phase_loop');
    assert.ok(phaseLoop, 'phase_loop not found');
    assert.strictEqual(
      phaseLoop.data.meta.source_doc_ref,
      '$.nodes.master_plan.doc_path'
    );

    // After round-trip
    const fullMeta = (parseYamlRaw(EXTRA_HIGH_YAML) as any).template;
    const serialized = serializeGraphToYaml(graph, fullMeta);
    const reparsed = parseYamlRaw(serialized) as any;
    const phaseLoopReparsed = findYamlNode(reparsed.nodes, 'phase_loop');
    assert.ok(phaseLoopReparsed, 'phase_loop not found in re-parsed YAML');
    assert.strictEqual(phaseLoopReparsed.source_doc_ref, '$.nodes.master_plan.doc_path');
  });
});
