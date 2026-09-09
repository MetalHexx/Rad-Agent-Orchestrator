import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runApprovePlan, approvePlanCommand } from '../../../src/commands/gate/approve-plan.js';
import { runCommand } from '../../../src/framework/command.js';

// Resolve the canonical templates dir (one walk above the cli root) so
// processEvent('start') can snapshot the medium template into the project.
const TEMPLATES_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'runtime-config', 'templates');

function makeProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-approve-plan-'));
  // Snapshot the medium template into the project so resolveTemplatePath
  // finds the project-local file without needing the bundle's templatesDir.
  fs.copyFileSync(path.join(TEMPLATES_DIR, 'medium.yml'), path.join(dir, 'template.yml'));
  return dir;
}

// Write a project-local orchestration.yml with a chosen execution_mode and pass
// its path explicitly to runApprovePlan. Required for hermeticity: runApprovePlan
// now defaults configPath to ~/.radorc/orchestration.yml discovery, so a test
// without an explicit config would read the dev's real home config and vary by
// machine. readConfig deep-merges this partial over DEFAULT_CONFIG.
function writeConfig(dir: string, executionMode: 'ask' | 'task' | 'phase' | 'autonomous'): string {
  const configPath = path.join(dir, 'orchestration.yml');
  fs.writeFileSync(configPath, `human_gates:\n  execution_mode: ${executionMode}\n`, 'utf8');
  return configPath;
}

async function scaffoldToPlanApprovalGate(dir: string): Promise<void> {
  // Reach into the pipeline lib directly to drive the project from start to
  // a state where plan_approved is the next legal event. Mirrors the
  // bring-up sequence in tests/fixtures/parity-states.ts.
  const { processEvent } = await import('../../../src/lib/pipeline-engine/engine.js');
  const { readState, writeState, readConfig, readDocument, readDocumentRaw, writeDocument, ensureDirectories } =
    await import('../../../src/lib/pipeline-engine/state-io.js');
  const pathContext = {
    scriptsDir: path.resolve(__dirname, '..', '..', '..', 'src', 'lib', 'pipeline-engine'),
    templatesDir: TEMPLATES_DIR,
    scriptPath: path.resolve(__dirname, '..', '..', '..', 'radorch.mjs'),
  };
  const io = { readState, writeState, readConfig, readDocument, readDocumentRaw, writeDocument, ensureDirectories };

  processEvent('start', dir, { template: 'medium' }, io, pathContext);

  // Mark master_plan + explode steps as completed with doc paths. master_plan is
  // the first node now (requirements is no longer a pipeline step), so `start`
  // lands master_plan in_progress directly.
  const mpDoc = path.join(dir, 'master-plan.md');
  fs.writeFileSync(mpDoc, '---\nproject: gate-test\ntype: master_plan\ntotal_phases: 1\ntotal_tasks: 1\n---\n# master plan\n');
  // Per FR-11, `_started` events are no longer accepted. Step nodes transition
  // to in_progress via the optimistic write in processEvent (FR-10), so
  // dispatching only `_completed` events is sufficient to advance the planner
  // chain from master_plan → explode_master_plan.
  processEvent('master_plan_completed', dir, { doc_path: mpDoc }, io, pathContext);
  processEvent('explosion_completed', dir, {}, io, pathContext);
  // After explosion_completed walkDAG should reach plan_approval_gate and
  // emit request_plan_approval; the gate node is now ready for plan_approved.
}

describe('radorch gate approve plan (FR-13, AD-5)', () => {
  let cwdBefore: string;
  beforeEach(() => { cwdBefore = process.cwd(); });
  afterEach(() => { process.chdir(cwdBefore); });

  it('mutates state to plan_approved and emits the canonical envelope', async () => {
    const dir = makeProject();
    await scaffoldToPlanApprovalGate(dir);

    const result = await runApprovePlan({ projectDir: dir, configPath: writeConfig(dir, 'ask') });

    expect(result.error).toBeUndefined();
    const state = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
    // Mutation contract: pipeline.current_tier becomes 'execution' and the
    // plan_approval_gate transitions to completed.
    expect(state.pipeline.current_tier).toBe('execution');
    expect(state.graph.nodes.plan_approval_gate.status).toBe('completed');
  });

  it('does not consult cwd for path resolution (AD-6)', async () => {
    const dir = makeProject();
    await scaffoldToPlanApprovalGate(dir);

    process.chdir(os.tmpdir());
    const result = await runApprovePlan({ projectDir: dir, configPath: writeConfig(dir, 'ask') });

    expect(result.error).toBeUndefined();
    const state = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
    // Mutation actually landed despite unrelated cwd
    expect(state.graph.nodes.plan_approval_gate.status).toBe('completed');
  });

  it('emits exactly one JSON blob on stdout (FR-13)', async () => {
    const dir = makeProject();
    await scaffoldToPlanApprovalGate(dir);
    const cfg = writeConfig(dir, 'ask');
    const stdoutChunks: string[] = [];

    const stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stdoutChunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    });

    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      stdoutChunks.push(args.map(String).join(' ') + '\n');
    });

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      // Mock process.exit to just return without actually exiting
      return undefined as never;
    });

    try {
      await runCommand(approvePlanCommand, {
        argv: ['--project-dir', dir, '--config', cfg],
        env: { ...process.env, RADORCH_NO_LOG: '1' },
        isTTY: false,
        stderr: process.stderr,
      });
    } catch {
      // Ignore any errors
    } finally {
      stdoutWriteSpy.mockRestore();
      consoleLogSpy.mockRestore();
      exitSpy.mockRestore();
    }

    const combined = stdoutChunks.join('');
    // Single parse must succeed against the entire stdout content.
    const parsed = JSON.parse(combined);
    expect(typeof parsed).toBe('object');
    // FR-13 contract: the parsed payload reaches the pipeline result via `.data`,
    // mirroring every other radorch subcommand's framework envelope shape.
    expect(parsed.data).toBeDefined();
    expect(parsed.data.action).toBeDefined();
  });

  // ── Regression: gate-approval must walk under the live orchestration.yml ─────
  // Bug: runApprovePlan called processEvent without a configPath, so readConfig
  // returned DEFAULT_CONFIG (execution_mode: 'ask'). The post-approval walk then
  // surfaced ask_gate_mode even when the operator's config said autonomous.
  // medium.yml chains plan_approval_gate → gate_mode_selection → phase_loop, so
  // the gate-mode gate is the first node the walk hits after approval.

  it('honors execution_mode=autonomous from the passed config — does not surface ask_gate_mode (regression)', async () => {
    const dir = makeProject();
    await scaffoldToPlanApprovalGate(dir);

    const result = await runApprovePlan({ projectDir: dir, configPath: writeConfig(dir, 'autonomous') });

    expect(result.error).toBeUndefined();
    // autonomous is in gate_mode_selection.auto_approve_modes, so the gate
    // auto-approves and the walk advances past it — never asking for gate mode.
    expect(result.action).not.toBe('ask_gate_mode');
  });

  it('honors execution_mode=ask from the passed config — surfaces ask_gate_mode', async () => {
    const dir = makeProject();
    await scaffoldToPlanApprovalGate(dir);

    const result = await runApprovePlan({ projectDir: dir, configPath: writeConfig(dir, 'ask') });

    expect(result.error).toBeUndefined();
    // Proves the passed config is actually consulted: under ask with no gate_mode
    // chosen yet, the walk stops and requests the gate mode.
    expect(result.action).toBe('ask_gate_mode');
  });
});
