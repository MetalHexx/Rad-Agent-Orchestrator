// graph-service/src/lifecycle/seed-from-template.ts — the dev seed helper: compiles a template
// file against a discovered registry, then replays the compiled steps one of two ways. This is
// the real logic behind `bin/seed.ts`'s thin shell, and the testable core the maximal template is
// proven against ahead of It. 4's installer.
import fs from 'node:fs/promises';
import path from 'node:path';
import type { NodeTypeDefinition, PrimitiveContext, ProjectScope } from '@rad-orchestration/graph-engine';
import { createNodeTypeRegistry } from '@rad-orchestration/graph-engine';
import { BUILT_IN_NODE_TYPES } from '@rad-orchestration/graph-node-types';
import { compose } from '../compose.js';
import { applySeedStep } from '../http/engine-graph.js';
import { discoverCustomNodeTypes } from '../node-types/scan.js';
import type { SeedStep } from '../seed-step.js';
import { compileTemplate } from '../templates/compile.js';
import { ensure } from './ensure.js';
import { resolveRadorcRoot } from './discovery.js';

export interface SeedFromTemplateOptions {
  readonly templatePath: string;
  readonly project: string;
  /** The `~/.radorc`-style root both node-type discovery and daemon discovery resolve under.
   *  Defaults to `resolveRadorcRoot()`. */
  readonly root?: string;
}

export interface SeedFromTemplateInProcessOptions extends SeedFromTemplateOptions {
  readonly dbPath: string;
}

export interface SeedFromTemplateResult {
  readonly project: string;
  readonly nodesCreated: number;
  readonly edgesCreated: number;
}

interface CompiledTemplate {
  readonly steps: readonly SeedStep[];
  readonly customNodeTypes: readonly NodeTypeDefinition[];
}

/**
 * Resolves the node-types root, discovers customs, builds the registry the template compiles
 * against, and compiles. All-or-nothing: a discovery or compile failure throws — no partial seed.
 */
async function compileFromTemplate(opts: SeedFromTemplateOptions): Promise<CompiledTemplate> {
  const root = opts.root ?? resolveRadorcRoot();
  const nodeTypesRoot = path.join(root, 'node-types');

  const { customs, errors } = await discoverCustomNodeTypes(nodeTypesRoot);
  if (errors.length > 0) {
    const detail = errors.map((error) => `${error.package}${error.entrypoint ? `:${error.entrypoint}` : ''} — ${error.reason}`).join('; ');
    throw new Error(`refusing to seed with ${errors.length} custom node-type load error(s): ${detail}`);
  }

  const registry = createNodeTypeRegistry(BUILT_IN_NODE_TYPES, customs);
  const source = await fs.readFile(opts.templatePath, 'utf8');
  const compiled = compileTemplate(source, registry);
  if (!compiled.ok) {
    throw new Error(`template '${opts.templatePath}' failed to compile (${compiled.error.kind}): ${compiled.error.message}`);
  }

  return { steps: compiled.steps, customNodeTypes: customs };
}

/**
 * The HTTP mode — the bin's real path: ensures a running daemon (`lifecycle/ensure.ts`'s own
 * `ensure()`), then `POST`s the compiled steps to `<url>/engine-graph/seed`.
 */
export async function seedFromTemplate(opts: SeedFromTemplateOptions): Promise<SeedFromTemplateResult> {
  const { steps } = await compileFromTemplate(opts);
  const { endpoint } = await ensure({ root: opts.root });

  const response = await fetch(`${endpoint}/engine-graph/seed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ project: opts.project, seed: { steps } }),
  });
  const body = (await response.json()) as {
    ok?: boolean;
    data?: { nodesCreated?: number; edgesCreated?: number };
    error?: { code?: string; message?: string };
  };
  if (body.ok !== true) {
    throw new Error(body.error?.message ?? `seed request to ${endpoint} failed with status ${response.status}`);
  }

  return {
    project: opts.project,
    nodesCreated: body.data?.nodesCreated ?? 0,
    edgesCreated: body.data?.edgesCreated ?? 0,
  };
}

/**
 * The in-process mode — the helper's testable core: replays the compiled steps against a composed
 * service (`compose()` over `opts.dbPath`) rather than a live HTTP daemon. First-touches the scope
 * (`execStore.listNodes`) to mint the `projects` anchor + root node before any `add_node` — the
 * same load-bearing ordering the `/seed` route itself relies on.
 */
export async function seedFromTemplateInProcess(opts: SeedFromTemplateInProcessOptions): Promise<SeedFromTemplateResult> {
  const { steps, customNodeTypes } = await compileFromTemplate(opts);
  const service = compose({ dbPath: opts.dbPath, customNodeTypes });
  try {
    const scope: ProjectScope = { projectId: opts.project };
    const ctx: PrimitiveContext = { store: service.execStore, scope };

    service.execStore.listNodes(scope);

    let nodesCreated = 0;
    let edgesCreated = 0;
    for (const step of steps) {
      const applied = applySeedStep(ctx, service.registry, step);
      if (!applied.ok) {
        throw new Error(`seed step failed (${applied.error.code}): ${applied.error.message}`);
      }
      nodesCreated += applied.data.nodeChanges.filter((change) => change.op === 'created').length;
      edgesCreated += applied.data.edgeChanges.filter((change) => change.op === 'created').length;
    }

    return { project: opts.project, nodesCreated, edgesCreated };
  } finally {
    service.db.close();
  }
}
