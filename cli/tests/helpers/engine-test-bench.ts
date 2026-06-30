import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import type {
  IOAdapter,
  OrchestrationConfig,
  PathContext,
  PipelineState,
} from '../../src/lib/pipeline-engine/types.js';
import { __setActionEventsRootForTests } from '../../src/lib/pipeline-engine/engine.js';

export interface CatalogFile {
  frontmatter: Record<string, unknown>;
  body: string;
}

export interface SeededCatalog {
  root: string;          // catalog directory (acts as userDataPaths().actionEvents)
  projectDir: string;    // temp project with state.json + template.yml
  pathContext: PathContext;
  templateId: string;    // id used in the seeded template (matches the filename stem)
}

function serializeFrontmatter(fm: Record<string, unknown>, body: string): string {
  return `---\n${yaml.dump(fm).trimEnd()}\n---\n${body}\n`;
}

function deriveFirstAction(files: Record<string, CatalogFile>): string | null {
  for (const name of Object.keys(files)) {
    const m = /^action\.([a-z0-9_]+)\.md$/.exec(name);
    if (m) return m[1]!;
  }
  return null;
}

const TEMPLATE_ID = 'test-template';

function templateBodyFor(opts: { firstNodeId: string; firstAction: string }): string {
  // Minimal single-step template adequate for `processEvent('start', ...)`.
  // Uses the `template:` + `nodes:` shape required by the production template loader.
  return [
    `template:`,
    `  id: ${TEMPLATE_ID}`,
    `  version: "1.0.0"`,
    `  description: "Synthetic single-step template for engine-test-bench"`,
    `nodes:`,
    `  - id: ${opts.firstNodeId}`,
    `    kind: step`,
    `    label: "${opts.firstNodeId}"`,
    `    action: ${opts.firstAction}`,
    `    events: { completed: ${opts.firstAction}_completed }`,
    `    context: { step: ${opts.firstNodeId} }`,
    `    depends_on: []`,
  ].join('\n') + '\n';
}

/** Build a temp catalog + project scaffold. Catalog files come from a map keyed by
 *  filename (e.g. 'action.spawn_planner.md'). A minimal `<TEMPLATE_ID>.yml` is
 *  also written into the project dir (which doubles as templatesDir) so that
 *  `processEvent('start', ...)` can load a template without a real
 *  ~/.radorc/templates/ directory.
 *
 *  The optional second argument `templateOpts` is preferred when present for
 *  determining `firstNodeId` and `firstAction`; otherwise `firstAction` is
 *  derived from the catalog filenames and `firstNodeId` falls back to
 *  `firstAction` (legacy behaviour — preserved for callers that do not pass
 *  explicit template opts). */
export function seedCatalog(
  files: Record<string, CatalogFile>,
  templateOpts?: { firstNodeId: string; firstAction: string },
): SeededCatalog {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-bench-cat-'));
  fs.mkdirSync(path.join(root, 'custom'), { recursive: true });
  for (const [name, file] of Object.entries(files)) {
    fs.writeFileSync(path.join(root, name), serializeFrontmatter(file.frontmatter, file.body));
  }
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-bench-proj-'));

  // Seed a minimal template so the engine can resolve and load.
  const resolvedFirstAction = templateOpts?.firstAction ?? deriveFirstAction(files);
  if (resolvedFirstAction) {
    const resolvedFirstNodeId = templateOpts?.firstNodeId ?? resolvedFirstAction;
    const body = templateBodyFor({ firstNodeId: resolvedFirstNodeId, firstAction: resolvedFirstAction });
    fs.writeFileSync(path.join(projectDir, `${TEMPLATE_ID}.yml`), body, 'utf8');
  }

  const pathContext: PathContext = { scriptsDir: projectDir, templatesDir: projectDir };
  return { root, projectDir, pathContext, templateId: TEMPLATE_ID };
}

export function seedTemplate(opts: { firstAction: string; firstNodeId?: string }): string {
  // Return the YAML body the engine would parse if loaded from disk. Provided
  // as a convenience for tests that want to inspect the template body — the
  // bench's `seedCatalog` already writes a `<TEMPLATE_ID>.yml` file to disk.
  return templateBodyFor({ firstNodeId: opts.firstNodeId ?? opts.firstAction, firstAction: opts.firstAction });
}

export interface TestIO extends IOAdapter {
  lastWrittenState: () => PipelineState;
  writeStateCallCount: () => number;
}

export interface MakeTestIOOpts {
  catalog?: string;
  template?: string;
  stateMissing?: boolean;
}

const DEFAULT_CONFIG: OrchestrationConfig = {
  limits: {
    max_retries_per_task: 3,
    max_consecutive_review_rejections: 3,
  },
  human_gates: { after_planning: true, execution_mode: 'task', after_final_review: true },
  source_control: { auto_commit: 'never', auto_pr: 'never' },
  default_template: TEMPLATE_ID,
};

/** In-memory IO double. Records every writeState call. The catalog path,
 *  when supplied, is installed into the engine's userDataPaths override
 *  hook so that `composeActionPrompt` reads from the seeded temp dir
 *  instead of `~/.radorc/action-events/`. */
export function makeTestIO(opts: MakeTestIOOpts = {}): TestIO {
  if (opts.catalog !== undefined) {
    __setActionEventsRootForTests(opts.catalog);
  }
  let written: PipelineState | null = null;
  let count = 0;
  const initial: PipelineState | null = opts.stateMissing
    ? null
    : null; // both branches return null — seedCatalog scaffolds a fresh project (state===null on disk).
  return {
    readState: () => (written ?? initial),
    writeState: (_dir, state) => { written = state; count++; },
    readConfig: () => DEFAULT_CONFIG,
    readDocument: (_docPath) => null,
    ensureDirectories: (_projectDir) => { /* no-op: seedCatalog already created the temp dir */ },
    lastWrittenState: () => {
      if (!written) throw new Error('writeState never called');
      return written;
    },
    writeStateCallCount: () => count,
  };
}

// FR-10: default node id and default action name are distinct strings so a
// future regression that derives the wrong identifier cannot pass tests by
// relying on a constructed collision.
const DEFAULT_FIRST_NODE_ID = 'step_one';
const DEFAULT_FIRST_ACTION = 'spawn_one';

/** Convenience: seed a minimal catalog with one action + completion event,
 *  plus a single-step template; return everything needed for the optimistic
 *  in_progress and no-started tests.
 *
 *  When called with no arguments the defaults are intentionally distinct
 *  (`step_one` for the node id, `spawn_one` for the action name) so a
 *  regression that derives the wrong identifier cannot accidentally pass by
 *  relying on a collision (FR-10). */
export function makeBench(opts: { firstAction?: string; firstNodeId?: string } = {}): {
  projectDir: string;
  pathContext: PathContext;
  io: TestIO;
  catalogRoot: string;
} {
  const firstAction = opts.firstAction ?? DEFAULT_FIRST_ACTION;
  const firstNodeId = opts.firstNodeId ?? DEFAULT_FIRST_NODE_ID;
  const cat = seedCatalog({
    [`action.${firstAction}.md`]: {
      frontmatter: {
        kind: 'action', name: firstAction, title: 't', description: 'd',
        category: 'agent-spawn', completion_event: `${firstAction}_completed`,
      },
      body: 'Body.',
    },
    [`event.${firstAction}_completed.md`]: {
      frontmatter: {
        kind: 'event', name: `${firstAction}_completed`, title: 't', description: 'd',
        signal_payload: {},
      },
      body: 'Event body.',
    },
  }, { firstNodeId, firstAction });
  return {
    projectDir: cat.projectDir,
    pathContext: cat.pathContext,
    io: makeTestIO({ catalog: cat.root }),
    catalogRoot: cat.root,
  };
}
