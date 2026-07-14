// graph-service/src/templates/compile.ts — the template loader: parses a YAML template document,
// resolves every declared node's `namespace:name` type against the injected registry, and emits the
// flat `SeedStep[]` the `/seed` route replays. All-or-nothing: any parse, type, cycle, or shape
// failure returns a structured `TemplateLoadError` and emits no steps.
import yaml from 'js-yaml';
import { ROOT_NODE_ID } from '@rad-orchestration/graph-engine';
import type { NodeTypeName, NodeTypeRegistry } from '@rad-orchestration/graph-engine';
import type { SeedAddNodeStep, SeedStep } from '../seed-step.js';

export interface TemplateLoadError {
  readonly kind: 'parse' | 'unknown_type' | 'cycle' | 'malformed';
  readonly message: string;
  readonly nodeId?: string;
}

export type TemplateCompileResult =
  | { readonly ok: true; readonly steps: readonly SeedStep[] }
  | { readonly ok: false; readonly error: TemplateLoadError };

interface TemplateNodeDeclaration {
  readonly id: string;
  readonly type: string;
  readonly order?: number;
  readonly dependsOn: readonly string[];
  readonly data?: Readonly<Record<string, unknown>>;
}

function fail(kind: TemplateLoadError['kind'], message: string, nodeId?: string): TemplateCompileResult {
  return { ok: false, error: nodeId === undefined ? { kind, message } : { kind, message, nodeId } };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Parses one `nodes:` entry, or returns the `TemplateLoadError` it fails with (never throws). */
function parseNodeDeclaration(raw: unknown, index: number): TemplateNodeDeclaration | TemplateLoadError {
  if (!isPlainObject(raw)) return { kind: 'malformed', message: `node ${index} must be an object` };

  const { id, type, order, depends_on: dependsOn, data } = raw;
  if (!isNonEmptyString(id)) return { kind: 'malformed', message: `node ${index} requires a string 'id'` };
  if (!isNonEmptyString(type)) return { kind: 'malformed', message: `node '${id}' requires a string 'type'`, nodeId: id };
  if (order !== undefined && typeof order !== 'number') {
    return { kind: 'malformed', message: `node '${id}' 'order' must be a number when present`, nodeId: id };
  }
  if (dependsOn !== undefined && (!Array.isArray(dependsOn) || !dependsOn.every(isNonEmptyString))) {
    return { kind: 'malformed', message: `node '${id}' 'depends_on' must be an array of node ids when present`, nodeId: id };
  }
  if (data !== undefined && !isPlainObject(data)) {
    return { kind: 'malformed', message: `node '${id}' 'data' must be an object when present`, nodeId: id };
  }

  return {
    id,
    type,
    order,
    dependsOn: (dependsOn as readonly string[] | undefined) ?? [],
    data: data as Readonly<Record<string, unknown>> | undefined,
  };
}

/** DFS over `depends_on` with a 3-color visit set; returns the id a cycle was found at, if any. */
function findCycleNodeId(declarations: readonly TemplateNodeDeclaration[]): string | undefined {
  const byId = new Map(declarations.map((declaration) => [declaration.id, declaration]));
  const state = new Map<string, 'visiting' | 'visited'>();

  function visit(id: string): string | undefined {
    const status = state.get(id);
    if (status === 'visited') return undefined;
    if (status === 'visiting') return id;

    state.set(id, 'visiting');
    for (const dep of byId.get(id)?.dependsOn ?? []) {
      const found = visit(dep);
      if (found) return found;
    }
    state.set(id, 'visited');
    return undefined;
  }

  for (const declaration of declarations) {
    const found = visit(declaration.id);
    if (found) return found;
  }
  return undefined;
}

/**
 * Parses a YAML template document (`template: { id, version, description }` + a flat `nodes:`
 * list) and compiles it to the `add_node` `SeedStep[]` the `/seed` route replays. The template is a
 * flat root spine — every declared node parents onto `ROOT_NODE_ID`, and inter-node edges ride on
 * `dependsOn` rather than separate `add_dependency` steps. All-or-nothing: the first parse, shape,
 * unknown-type, or cycle failure returns the error and emits no steps.
 */
export function compileTemplate(source: string, registry: NodeTypeRegistry): TemplateCompileResult {
  let parsed: unknown;
  try {
    parsed = yaml.load(source, { schema: yaml.JSON_SCHEMA });
  } catch (error) {
    return fail('parse', error instanceof Error ? error.message : String(error));
  }

  if (!isPlainObject(parsed)) return fail('malformed', 'template document must be a YAML mapping');

  const { template, nodes } = parsed;
  if (!isPlainObject(template)) return fail('malformed', "template document requires a 'template' object");
  if (!isNonEmptyString(template.id) || !isNonEmptyString(template.version) || !isNonEmptyString(template.description)) {
    return fail('malformed', "'template' requires string 'id', 'version', and 'description'");
  }
  if (!Array.isArray(nodes)) return fail('malformed', "template document requires a 'nodes' array");

  const declarations: TemplateNodeDeclaration[] = [];
  const seenIds = new Set<string>();
  for (let index = 0; index < nodes.length; index += 1) {
    const declaration = parseNodeDeclaration(nodes[index], index);
    if ('kind' in declaration) return { ok: false, error: declaration };
    if (seenIds.has(declaration.id)) return fail('malformed', `duplicate node id '${declaration.id}'`, declaration.id);
    seenIds.add(declaration.id);
    declarations.push(declaration);
  }

  for (const declaration of declarations) {
    if (!registry.resolve(declaration.type as NodeTypeName)) {
      return fail('unknown_type', `node '${declaration.id}' references unknown type '${declaration.type}'`, declaration.id);
    }
    for (const dep of declaration.dependsOn) {
      if (!seenIds.has(dep)) {
        return fail('malformed', `node '${declaration.id}' depends_on references unknown node '${dep}'`, declaration.id);
      }
    }
  }

  const cycleNodeId = findCycleNodeId(declarations);
  if (cycleNodeId !== undefined) return fail('cycle', `dependency cycle detected at node '${cycleNodeId}'`, cycleNodeId);

  const steps: readonly SeedAddNodeStep[] = declarations.map((declaration, index) => ({
    primitive: 'add_node',
    id: declaration.id,
    type: declaration.type as NodeTypeName,
    parent: ROOT_NODE_ID,
    order: declaration.order ?? index,
    data: declaration.data,
    dependsOn: declaration.dependsOn.length > 0 ? declaration.dependsOn : undefined,
  }));

  return { ok: true, steps };
}
