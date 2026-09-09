import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { amendmentStatus } from '../../../src/commands/amendment/status.js';
import { applyAmendment } from '../../../src/lib/amendment/apply.js';
import {
  ALL_PHASES_DONE,
  APPENDS_A_PHASE,
  HALTED_MID_PLAN,
  MID_PHASE,
  NOW,
  makeProject,
} from '../../helpers/amendment-fixture.js';

const REQUIREMENTS_WITH_SEAL = [
  '---',
  'project: DEMO',
  'type: requirements',
  'template: standard',
  'task-size: standard',
  '---',
  '',
  '# DEMO — Requirements',
  '',
  '## Functional',
  '',
  '- The system carries the reader from end to end.',
  '',
].join('\n');

describe('amendment status', () => {
  it('projects the frontier for a mid-run project, with every frozen entry carrying a reason', () => {
    const fixture = makeProject({ phases: MID_PHASE, requirements: REQUIREMENTS_WITH_SEAL });

    const result = amendmentStatus({ projectDir: fixture.projectDir });

    expect(Object.keys(result).sort()).toEqual([
      'applied', 'firstEditablePhase', 'next', 'phases', 'sealed', 'stoppingPoint',
    ]);
    expect(result.sealed).toEqual({ template: 'standard', taskSize: 'standard' });
    expect(result.firstEditablePhase).toBe('P02');

    for (const phase of result.phases) {
      if (!phase.editable) expect(phase.frozenReason).not.toBeNull();
      for (const task of phase.tasks) {
        if (!task.editable) expect(task.frozenReason).not.toBeNull();
      }
    }

    expect(result.phases.map(phase => ({ id: phase.id, editable: phase.editable, frozenReason: phase.frozenReason }))).toEqual([
      { id: 'P01', editable: false, frozenReason: 'completed' },
      { id: 'P02', editable: true, frozenReason: null },
      { id: 'P03', editable: true, frozenReason: null },
    ]);
    expect(result.phases[1]!.tasks).toEqual([
      { id: 'P02-T01', title: 'Serve the reader', repo: 'beta', editable: false, frozenReason: 'completed' },
    ]);
    expect(result.phases[2]!.tasks).toEqual([
      { id: 'P03-T01', title: 'Close the loop', repo: 'beta', editable: true, frozenReason: null },
    ]);
  });

  it('reports applied: [] and next: { index: 1 } for a never-amended project, with an unsealed Requirements doc', () => {
    const fixture = makeProject({ phases: MID_PHASE });

    const result = amendmentStatus({ projectDir: fixture.projectDir });

    expect(result.applied).toEqual([]);
    expect(result.next).toEqual({ index: 1, fileName: 'DEMO-AMENDMENT-01.md' });
    expect(result.sealed).toEqual({ template: null, taskSize: null });
  });

  it('advances next.index and applied once an amendment has landed', () => {
    const fixture = makeProject({ phases: MID_PHASE, amendment: APPENDS_A_PHASE });
    const outcome = applyAmendment({ projectDir: fixture.projectDir, amendmentPath: fixture.amendmentPath, nowIso: NOW });
    if (outcome.type !== 'applied') throw new Error(`apply refused: ${JSON.stringify(outcome)}`);

    const result = amendmentStatus({ projectDir: fixture.projectDir });

    expect(result.applied.map(entry => entry.index)).toEqual([1]);
    expect(result.applied[0]).toMatchObject({ doc_path: 'DEMO-AMENDMENT-01.md', adds_phases: ['P04'] });
    expect(result.next).toEqual({ index: 2, fileName: 'DEMO-AMENDMENT-02.md' });
    expect(result.phases.map(phase => phase.id)).toEqual(['P01', 'P02', 'P03', 'P04']);
  });

  it('reports both sealed values null when the Requirements doc is missing', () => {
    const fixture = makeProject({ phases: MID_PHASE });
    fs.rmSync(fixture.requirementsPath);

    const result = amendmentStatus({ projectDir: fixture.projectDir });

    expect(result.sealed).toEqual({ template: null, taskSize: null });
  });

  it('throws the same "no Master Plan recorded" fault validate reports when the doc_path is unset', () => {
    const fixture = makeProject({ phases: MID_PHASE });
    const state = JSON.parse(fs.readFileSync(fixture.statePath, 'utf8')) as Record<string, unknown>;
    const graph = state['graph'] as Record<string, unknown>;
    const nodes = graph['nodes'] as Record<string, unknown>;
    nodes['master_plan'] = { ...(nodes['master_plan'] as Record<string, unknown>), doc_path: null };
    fs.writeFileSync(fixture.statePath, JSON.stringify(state, null, 2), 'utf8');

    expect(() => amendmentStatus({ projectDir: fixture.projectDir })).toThrow(/No Master Plan recorded/);
  });

  describe('stoppingPoint', () => {
    it('reports awaiting_plan_approval when the plan approval gate is armed', () => {
      const fixture = makeProject({
        phases: MID_PHASE,
        planApprovalGate: { status: 'in_progress', gate_active: true },
      });

      const result = amendmentStatus({ projectDir: fixture.projectDir });

      expect(result.stoppingPoint.at).toBe('awaiting_plan_approval');
      expect(result.stoppingPoint.node).toBe('plan_approval_gate');
    });

    it('reports phase_loop_not_started for a plan exploded but never run', () => {
      const fixture = makeProject({ phases: MID_PHASE, phaseLoop: 'not_started' });

      const result = amendmentStatus({ projectDir: fixture.projectDir });

      expect(result.stoppingPoint.at).toBe('phase_loop_not_started');
      expect(result.stoppingPoint.node).toBe('phase_loop');
    });

    it('reports phase_loop_in_progress for a project mid-phase', () => {
      const fixture = makeProject({ phases: MID_PHASE });

      const result = amendmentStatus({ projectDir: fixture.projectDir });

      expect(result.stoppingPoint.at).toBe('phase_loop_in_progress');
      expect(result.stoppingPoint.node).toBe('phase_loop');
    });

    it('reports awaiting_final_review once every phase is done and final review has not started', () => {
      const fixture = makeProject({ phases: ALL_PHASES_DONE, phaseLoop: 'completed' });

      const result = amendmentStatus({ projectDir: fixture.projectDir });

      expect(result.stoppingPoint.at).toBe('awaiting_final_review');
      expect(result.stoppingPoint.node).toBe('final_review');
    });

    it('reports final_review_in_progress while final review or a corrective is running', () => {
      const fixture = makeProject({
        phases: ALL_PHASES_DONE,
        phaseLoop: 'completed',
        finalReview: { status: 'in_progress' },
      });

      const result = amendmentStatus({ projectDir: fixture.projectDir });

      expect(result.stoppingPoint.at).toBe('final_review_in_progress');
      expect(result.stoppingPoint.node).toBe('final_review');
    });

    it('reports pr_gate once final review is done and the PR conditional has not resolved', () => {
      const fixture = makeProject({
        phases: ALL_PHASES_DONE,
        phaseLoop: 'completed',
        finalReview: { status: 'completed' },
      });

      const result = amendmentStatus({ projectDir: fixture.projectDir });

      expect(result.stoppingPoint.at).toBe('pr_gate');
      expect(result.stoppingPoint.node).toBe('pr_gate');
    });

    it('reports final_approval_gate when it is armed', () => {
      const fixture = makeProject({
        phases: ALL_PHASES_DONE,
        phaseLoop: 'completed',
        finalReview: { status: 'completed' },
        prGate: { status: 'completed' },
        finalApprovalGate: { status: 'in_progress', gate_active: true },
      });

      const result = amendmentStatus({ projectDir: fixture.projectDir });

      expect(result.stoppingPoint.at).toBe('final_approval_gate');
      expect(result.stoppingPoint.node).toBe('final_approval_gate');
    });

    it('reports halted with the halted top-level node for a rejection halt on final review', () => {
      const fixture = makeProject({
        phases: ALL_PHASES_DONE,
        phaseLoop: 'completed',
        graphStatus: 'halted',
        haltReason: 'the operator rejected the final review',
        finalReview: { status: 'halted' },
        // Armed so a frontier-only, or halted-node-only, implementation that skips
        // straight past the halt test would confidently report the gate instead.
        finalApprovalGate: { status: 'in_progress', gate_active: true },
      });

      const result = amendmentStatus({ projectDir: fixture.projectDir });

      expect(result.stoppingPoint.at).toBe('halted');
      expect(result.stoppingPoint.node).toBe('final_review');
    });

    it('reports halted with a resolved node for a mid-plan halt with no halted top-level node', () => {
      const fixture = makeProject({
        phases: HALTED_MID_PLAN,
        graphStatus: 'halted',
        haltReason: 'a coder could not proceed',
      });

      const result = amendmentStatus({ projectDir: fixture.projectDir });

      expect(result.stoppingPoint.at).toBe('halted');
      expect(result.stoppingPoint.node).not.toBeNull();
    });

    it('does not report final_approval_gate for a gate that is not_started with gate_active false', () => {
      const fixture = makeProject({
        phases: ALL_PHASES_DONE,
        phaseLoop: 'completed',
        finalReview: { status: 'completed' },
        prGate: { status: 'completed' },
      });

      const result = amendmentStatus({ projectDir: fixture.projectDir });

      expect(result.stoppingPoint.at).not.toBe('final_approval_gate');
    });

    it('does not report final_approval_gate for an approved gate left completed with gate_active true', () => {
      const fixture = makeProject({
        phases: ALL_PHASES_DONE,
        phaseLoop: 'completed',
        finalReview: { status: 'completed' },
        prGate: { status: 'completed' },
        finalApprovalGate: { status: 'completed', gate_active: true },
      });

      const result = amendmentStatus({ projectDir: fixture.projectDir });

      expect(result.stoppingPoint.at).not.toBe('final_approval_gate');
    });

    it('reports unknown with a null node when nothing in the graph matches a rule', () => {
      const fixture = makeProject({
        phases: ALL_PHASES_DONE,
        phaseLoop: 'completed',
        finalReview: { status: 'completed' },
        prGate: { status: 'completed' },
      });

      const result = amendmentStatus({ projectDir: fixture.projectDir });

      expect(result.stoppingPoint.at).toBe('unknown');
      expect(result.stoppingPoint.node).toBeNull();
    });

    it('treats a snapshot missing pr_gate as skipped rather than incomplete', () => {
      const fixture = makeProject({
        phases: ALL_PHASES_DONE,
        phaseLoop: 'completed',
        finalReview: { status: 'completed' },
        finalApprovalGate: { status: 'in_progress', gate_active: true },
        omitNodes: ['pr_gate'],
      });

      const result = amendmentStatus({ projectDir: fixture.projectDir });

      expect(result.stoppingPoint.at).toBe('final_approval_gate');
      expect(result.stoppingPoint.node).toBe('final_approval_gate');
    });
  });
});
