import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runApproveFinal, approveFinalCommand } from '../../../src/commands/gate/approve-final.js';
import { runCommand } from '../../../src/framework/command.js';

const TEMPLATES_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'runtime-config', 'templates');

/**
 * Build a project at the final_approval_gate. Cheaper than driving the full
 * pipeline: scaffold via `start`, then write a hand-crafted state where every
 * predecessor node carries `status: completed` so the final-approved mutation
 * can land without DAG-walker objections.
 */
async function makeProjectAtFinalGate(): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-approve-final-'));
  fs.copyFileSync(path.join(TEMPLATES_DIR, 'medium.yml'), path.join(dir, 'template.yml'));
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

  // Mutate the state directly: mark every top-level node up to final_approval_gate
  // as completed, then write it back. The engine's standard route only requires
  // the mutation's target node to exist — it does NOT re-walk predecessors.
  const state = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
  for (const nodeId of ['requirements', 'master_plan', 'explode_master_plan',
    'plan_approval_gate', 'gate_mode_selection', 'phase_loop', 'final_review', 'pr_gate']) {
    if (state.graph.nodes[nodeId]) {
      state.graph.nodes[nodeId].status = 'completed';
    }
  }
  // The final_approval_gate must exist as a scaffolded node before the mutation
  // can resolve it.
  state.pipeline.current_tier = 'review';
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(state, null, 2));
  return dir;
}

// Write a project-local orchestration.yml and pass its path explicitly to
// runApproveFinal. Required for hermeticity: runApproveFinal now defaults
// configPath to ~/.radorc/orchestration.yml discovery (mirroring `pipeline
// signal` and `gate approve plan`), so a test without an explicit config would
// read the dev's real home config. readConfig deep-merges this partial over
// DEFAULT_CONFIG. after_final_review governs whether the final gate is *required*
// (covered by final_review.behavioral.test.ts); here it pins the config so the
// approval is driven deterministically.
function writeConfig(dir: string, afterFinalReview: boolean): string {
  const configPath = path.join(dir, 'orchestration.yml');
  fs.writeFileSync(configPath, `human_gates:\n  after_final_review: ${afterFinalReview}\n`, 'utf8');
  return configPath;
}

describe('radorch gate approve final (FR-13, AD-5)', () => {
  it('mutates final_approval_gate to completed and emits the canonical envelope', async () => {
    const dir = await makeProjectAtFinalGate();
    const result = await runApproveFinal({ projectDir: dir, configPath: writeConfig(dir, true) });

    expect(result.error).toBeUndefined();
    const state = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
    expect(state.graph.nodes.final_approval_gate.status).toBe('completed');
    expect(state.graph.nodes.final_approval_gate.gate_active).toBe(true);
  });

  it('does not consult cwd for path resolution (AD-6)', async () => {
    const dir = await makeProjectAtFinalGate();
    const cwdBefore = process.cwd();
    process.chdir(os.tmpdir());
    try {
      const result = await runApproveFinal({ projectDir: dir, configPath: writeConfig(dir, true) });
      expect(result.error).toBeUndefined();
      const state = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
      expect(state.graph.nodes.final_approval_gate.status).toBe('completed');
    } finally {
      process.chdir(cwdBefore);
    }
  });

  it('emits exactly one JSON blob on stdout (FR-13)', async () => {
    const dir = await makeProjectAtFinalGate();
    const cfg = writeConfig(dir, true);
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
      await runCommand(approveFinalCommand, {
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

  // ── Symmetry with `gate approve plan`: walk under the live orchestration.yml ─
  // runApproveFinal had the identical latent config-path bug — it called
  // processEvent without a configPath. It now defaults to discovering
  // ~/.radorc/orchestration.yml and accepts an explicit override. The
  // final-approval *requirement* (after_final_review) is exercised end-to-end in
  // final_review.behavioral.test.ts; here we assert the approval lands when
  // driven with an explicit config path.
  it('accepts and honors an explicit config path', async () => {
    const dir = await makeProjectAtFinalGate();

    const result = await runApproveFinal({ projectDir: dir, configPath: writeConfig(dir, true) });

    expect(result.error).toBeUndefined();
    const state = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
    expect(state.graph.nodes.final_approval_gate.status).toBe('completed');
  });
});
