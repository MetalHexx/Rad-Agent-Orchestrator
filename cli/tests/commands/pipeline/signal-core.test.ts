import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import yaml from 'js-yaml';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { pipelineSignal } from '../../../src/commands/pipeline/signal.js';
import { __setActionEventsRootForTests } from '../../../src/lib/pipeline-engine/engine.js';
import type { IOAdapter, OrchestrationConfig, PathContext, PipelineResult } from '../../../src/lib/pipeline-engine/types.js';

const REPO_ACTION_EVENTS_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'runtime-config', 'action-events');
beforeEach(() => { __setActionEventsRootForTests(REPO_ACTION_EVENTS_DIR); });
afterEach(() => { __setActionEventsRootForTests(null); });

function makeStubIO(_result: PipelineResult): { io: IOAdapter; calls: unknown[] } {
  const calls: unknown[] = [];
  const io: IOAdapter = {
    readState: () => null,
    writeState: () => { calls.push('writeState'); },
    readConfig: () => ({ limits: { max_phases: 10, max_tasks_per_phase: 8, max_retries_per_task: 3, max_consecutive_review_rejections: 3 },
                        human_gates: { after_planning: true, execution_mode: 'task', after_final_review: true },
                        source_control: { auto_commit: 'never', auto_pr: 'never' },
                        default_template: 'medium' }),
    readDocument: () => null,
    ensureDirectories: () => { calls.push('ensureDirectories'); },
  };
  // result is unused here — pipelineSignal is wired with the real engine; the stubs above suffice
  // to drive the start-event happy path through scaffolding.
  return { io, calls };
}

const pathContext: PathContext = {
  scriptsDir: os.tmpdir(),
  templatesDir: path.resolve(__dirname, '..', '..', '..', '..', 'runtime-config', 'templates'),
};

describe('pipelineSignal core function', () => {
  it('projects engine result into { action, context, prompt, completion_event, has_custom_instructions } on success (FR-7)', async () => {
    const { io } = makeStubIO({ action: 'spawn_master_plan', context: {} });
    const r = await pipelineSignal({ event: 'start', projectDir: '/tmp/proj', context: {}, io, pathContext });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Object.keys(r.data).sort()).toEqual(['action', 'completion_event', 'context', 'has_custom_instructions', 'prompt']);
    }
  });

  it('maps engine failure to { ok:false, data:{ event }, error:{ type:user_error } }', async () => {
    const { io } = makeStubIO({ action: null, context: {}, error: { message: 'bad', event: 'unknown' } });
    const r = await pipelineSignal({ event: 'totally_unknown_event', projectDir: '/tmp/proj', context: {}, io, pathContext });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.type).toBe('user_error');
      expect(r.data?.event).toBeDefined();
    }
  });
});

// ── Helpers for has_custom_instructions surfacing tests ───────────────────────

const SIGNAL_CORE_TEMPLATE_ID = 'signal-core-test-template';

function makeMinimalTemplate(actionName: string): string {
  return [
    `template:`,
    `  id: ${SIGNAL_CORE_TEMPLATE_ID}`,
    `  version: "1.0.0"`,
    `  description: "Synthetic single-step template for signal-core suite"`,
    `nodes:`,
    `  - id: ${actionName}_step`,
    `    kind: step`,
    `    label: "${actionName}"`,
    `    action: ${actionName}`,
    `    events: { completed: ${actionName}_done }`,
    `    context: {}`,
    `    depends_on: []`,
  ].join('\n') + '\n';
}

function serializeFm(fm: Record<string, unknown>, body: string): string {
  return `---\n${yaml.dump(fm).trimEnd()}\n---\n${body}\n`;
}

/**
 * Creates a minimal temp catalog with action.foo.md + event.foo_done.md.
 * When `overlay` is provided, writes each key as a custom slot file:
 *   'action.foo.pre' → custom/action.foo.pre.md
 * Returns the catalog root path (also used as templatesDir).
 */
function seedCatalogWithOverlay(overlay: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'signal-core-cat-'));
  fs.mkdirSync(path.join(root, 'custom'), { recursive: true });
  // action.foo.md
  fs.writeFileSync(
    path.join(root, 'action.foo.md'),
    serializeFm(
      { kind: 'action', name: 'foo', title: 't', description: 'd', category: 'agent-spawn', completion_event: 'foo_done' },
      'Foo action body.',
    ),
  );
  // event.foo_done.md
  fs.writeFileSync(
    path.join(root, 'event.foo_done.md'),
    serializeFm(
      { kind: 'event', name: 'foo_done', title: 't', description: 'd', signal_payload: {} },
      'Foo event body.',
    ),
  );
  // Custom overlay slot files
  for (const [key, content] of Object.entries(overlay)) {
    fs.writeFileSync(path.join(root, 'custom', `${key}.md`), content, 'utf8');
  }
  // Minimal template file (root doubles as templatesDir)
  fs.writeFileSync(path.join(root, `${SIGNAL_CORE_TEMPLATE_ID}.yml`), makeMinimalTemplate('foo'), 'utf8');
  return root;
}

/**
 * Creates a minimal temp catalog with action.foo.md + event.foo_done.md and
 * no custom overlay files.
 */
function seedCatalogNoOverlay(): string {
  return seedCatalogWithOverlay({});
}

const DEFAULT_CONFIG: OrchestrationConfig = {
  limits: { max_phases: 10, max_tasks_per_phase: 8, max_retries_per_task: 3, max_consecutive_review_rejections: 3 },
  human_gates: { after_planning: true, execution_mode: 'task', after_final_review: true },
  source_control: { auto_commit: 'never', auto_pr: 'never' },
  default_template: SIGNAL_CORE_TEMPLATE_ID,
};

interface RunEnvelopeOpts {
  event: string;
  catalogRoot: string;
  expectAction: string;
}

/**
 * Drives pipelineSignal() end-to-end using a seeded temp catalog and a
 * matching single-step template. Returns the raw envelope.
 */
async function runProcessEventToSignalEnvelope(
  opts: RunEnvelopeOpts,
): Promise<ReturnType<typeof pipelineSignal> extends Promise<infer T> ? T : never> {
  const { catalogRoot } = opts;
  __setActionEventsRootForTests(catalogRoot);
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'signal-core-proj-'));
  try {
    const io: IOAdapter = {
      readState: () => null,
      writeState: () => { /* no-op */ },
      readConfig: () => DEFAULT_CONFIG,
      readDocument: () => null,
      ensureDirectories: () => { /* no-op */ },
    };
    const pc: PathContext = { scriptsDir: projectDir, templatesDir: catalogRoot };
    return await pipelineSignal({ event: opts.event, projectDir, context: {}, io, pathContext: pc }) as ReturnType<typeof pipelineSignal> extends Promise<infer T> ? T : never;
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(catalogRoot, { recursive: true, force: true });
    __setActionEventsRootForTests(null);
  }
}

describe('pipeline signal envelope — has_custom_instructions surfacing', () => {
  it('places has_custom_instructions inside data alongside prompt and completion_event when composer admits overlay', async () => {
    // Use the same fixture seam the rest of this file uses; the assertion
    // is shape-only — both the engine helper return AND the wrapping
    // success envelope's `data` block must carry the boolean.
    const root = seedCatalogWithOverlay({ 'action.foo.pre': 'inline pre' });
    const envelope = await runProcessEventToSignalEnvelope({
      event: 'start',
      catalogRoot: root,
      expectAction: 'foo',
    });
    expect(envelope.ok).toBe(true);
    if (envelope.ok) {
      expect(envelope.data).toMatchObject({
        action: 'foo',
        prompt: expect.stringMatching(/^## Step 1\n\ninline pre/),
        has_custom_instructions: true,
      });
    }
  });

  it('places has_custom_instructions=false in data when only shipped content is composed', async () => {
    const root = seedCatalogNoOverlay();
    const envelope = await runProcessEventToSignalEnvelope({
      event: 'start',
      catalogRoot: root,
      expectAction: 'foo',
    });
    expect(envelope.ok).toBe(true);
    if (envelope.ok) {
      expect(envelope.data.has_custom_instructions).toBe(false);
    }
  });
});
