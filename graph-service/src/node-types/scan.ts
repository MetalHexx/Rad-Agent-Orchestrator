// graph-service/src/node-types/scan.ts
//
// Host-side scanner for `~/.radorc/node-types/custom` — reads each package's `manifest.yml`,
// dynamic-imports its declared entrypoints, and validates the default export as a well-formed
// `NodeTypeDefinition` cross-checked against the manifest. Every import/parse/validation failure
// becomes a named `NodeTypeLoadError`, collected rather than thrown, so one bad package never
// crashes discovery of the rest. `createNodeTypeRegistry` (P02-T03) is the sole enforcer of the
// reserved `rad-orc:` prefix and global name-uniqueness — this loader defers both.
import { pathToFileURL } from 'node:url';
import * as fs from 'node:fs';
import * as path from 'node:path';
import yaml from 'js-yaml';
import { DATA_FIELD_KINDS, DATA_FIELD_LEVELS, type NodeTypeDefinition } from '@rad-orchestration/graph-engine';

export interface NodeTypeLoadError {
  readonly package: string;
  readonly entrypoint?: string;
  readonly reason: string;
}

export interface DiscoveryResult {
  readonly customs: readonly NodeTypeDefinition[];
  readonly errors: readonly NodeTypeLoadError[];
}

interface ManifestNodeTypeEntry {
  readonly name: string;
  readonly entrypoint: string;
}

interface Manifest {
  readonly namespace: string;
  readonly nodeTypes: readonly ManifestNodeTypeEntry[];
}

const REQUIRED_DEFINITION_HOOKS = ['act', 'handle', 'projectStatus'] as const;
const REQUIRED_DEFINITION_FIELDS = ['dataSchema', 'traits', 'capabilities', 'presentation', 'instructions'] as const;

/**
 * Scans `<nodeTypesRoot>/custom/<pkg>/manifest.yml` only — `<nodeTypesRoot>/builtin` is a
 * recognized-but-not-loaded slot this iteration. Never throws: a directory with no `custom`
 * subtree yields an empty result, and every per-package/per-entry failure becomes a
 * `NodeTypeLoadError` rather than an unhandled rejection.
 */
export async function discoverCustomNodeTypes(nodeTypesRoot: string): Promise<DiscoveryResult> {
  const customs: NodeTypeDefinition[] = [];
  const errors: NodeTypeLoadError[] = [];
  const customRoot = path.join(nodeTypesRoot, 'custom');

  let packageDirs: readonly string[];
  try {
    const entries = await fs.promises.readdir(customRoot, { withFileTypes: true });
    packageDirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') return { customs, errors };
    errors.push({ package: customRoot, reason: `failed to read custom node-types directory: ${describeError(error)}` });
    return { customs, errors };
  }

  for (const pkgDirName of packageDirs) {
    await loadPackage(customRoot, pkgDirName, customs, errors);
  }

  return { customs, errors };
}

async function loadPackage(
  customRoot: string,
  pkgDirName: string,
  customs: NodeTypeDefinition[],
  errors: NodeTypeLoadError[],
): Promise<void> {
  const pkgDir = path.join(customRoot, pkgDirName);
  const manifestPath = path.join(pkgDir, 'manifest.yml');

  let manifestText: string;
  try {
    manifestText = await fs.promises.readFile(manifestPath, 'utf8');
  } catch (error) {
    // No manifest.yml means this directory isn't a package at all — not an error, just skipped.
    if (isErrnoException(error) && error.code === 'ENOENT') return;
    errors.push({ package: pkgDirName, reason: `failed to read manifest.yml: ${describeError(error)}` });
    return;
  }

  let manifest: Manifest;
  try {
    manifest = parseManifest(manifestText);
  } catch (error) {
    errors.push({ package: pkgDirName, reason: `invalid manifest.yml: ${describeError(error)}` });
    return;
  }

  for (const entry of manifest.nodeTypes) {
    await loadNodeType(pkgDir, pkgDirName, manifest, entry, customs, errors);
  }
}

/** Parses and structurally validates a manifest's `namespace`/`nodeTypes` — `templates:` is reserved and ignored. */
function parseManifest(text: string): Manifest {
  const parsed = yaml.load(text, { schema: yaml.JSON_SCHEMA });
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('manifest.yml did not parse to an object');
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record.namespace !== 'string' || record.namespace.length === 0) {
    throw new Error('manifest.yml is missing a string "namespace"');
  }
  if (!Array.isArray(record.nodeTypes)) {
    throw new Error('manifest.yml is missing a "nodeTypes" array');
  }
  const nodeTypes = record.nodeTypes.map((raw: unknown, index: number) => {
    if (typeof raw !== 'object' || raw === null) {
      throw new Error(`nodeTypes[${index}] is not an object`);
    }
    const rawEntry = raw as Record<string, unknown>;
    if (typeof rawEntry.name !== 'string' || rawEntry.name.length === 0) {
      throw new Error(`nodeTypes[${index}] is missing a string "name"`);
    }
    if (typeof rawEntry.entrypoint !== 'string' || rawEntry.entrypoint.length === 0) {
      throw new Error(`nodeTypes[${index}] is missing a string "entrypoint"`);
    }
    return { name: rawEntry.name, entrypoint: rawEntry.entrypoint };
  });
  return { namespace: record.namespace, nodeTypes };
}

async function loadNodeType(
  pkgDir: string,
  pkgDirName: string,
  manifest: Manifest,
  entry: ManifestNodeTypeEntry,
  customs: NodeTypeDefinition[],
  errors: NodeTypeLoadError[],
): Promise<void> {
  // Windows gotcha: `import()` rejects a bare absolute Windows path — it must be a file URL.
  const absEntrypoint = path.resolve(pkgDir, entry.entrypoint);

  const relative = path.relative(pkgDir, absEntrypoint);
  if (relative.length === 0 || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    errors.push({
      package: pkgDirName,
      entrypoint: entry.entrypoint,
      reason: `entrypoint '${entry.entrypoint}' resolves outside the package directory`,
    });
    return;
  }

  let candidate: unknown;
  try {
    const mod = (await import(pathToFileURL(absEntrypoint).href)) as { default?: unknown };
    candidate = mod.default;
  } catch (error) {
    errors.push({
      package: pkgDirName,
      entrypoint: entry.entrypoint,
      reason: `failed to import module: ${describeError(error)}`,
    });
    return;
  }

  const shapeError = validateShape(candidate);
  if (shapeError !== undefined) {
    errors.push({ package: pkgDirName, entrypoint: entry.entrypoint, reason: shapeError });
    return;
  }

  const definition = candidate as NodeTypeDefinition;
  if (definition.name !== entry.name) {
    errors.push({
      package: pkgDirName,
      entrypoint: entry.entrypoint,
      reason: `exported name '${definition.name}' does not match manifest-declared name '${entry.name}'`,
    });
    return;
  }
  if (!definition.name.startsWith(`${manifest.namespace}:`)) {
    errors.push({
      package: pkgDirName,
      entrypoint: entry.entrypoint,
      reason: `exported name '${definition.name}' is not under manifest namespace '${manifest.namespace}'`,
    });
    return;
  }

  customs.push(definition);
}

/** Structural check only — the reserved-prefix and uniqueness rules are `createNodeTypeRegistry`'s job. */
function validateShape(candidate: unknown): string | undefined {
  if (typeof candidate !== 'object' || candidate === null) {
    return 'default export is not an object';
  }
  const record = candidate as Record<string, unknown>;
  if (typeof record.name !== 'string' || !record.name.includes(':')) {
    return `"name" is not a well-formed "namespace:name" string (got ${JSON.stringify(record.name)})`;
  }
  for (const hook of REQUIRED_DEFINITION_HOOKS) {
    if (typeof record[hook] !== 'function') {
      return `"${hook}" is not a function`;
    }
  }
  for (const field of REQUIRED_DEFINITION_FIELDS) {
    if (record[field] === undefined) {
      return `missing required field "${field}"`;
    }
  }
  if (!Array.isArray(record.traits)) {
    return `"traits" is not an array (got ${JSON.stringify(record.traits)})`;
  }
  if (!Array.isArray(record.capabilities)) {
    return `"capabilities" is not an array (got ${JSON.stringify(record.capabilities)})`;
  }
  if (typeof record.instructions !== 'string') {
    return `"instructions" is not a string (got ${JSON.stringify(record.instructions)})`;
  }
  if (!isPlainObject(record.presentation) || typeof record.presentation.label !== 'string') {
    return `"presentation" is not a well-formed Presentation object (requires a string "label")`;
  }
  if (!isPlainObject(record.dataSchema)) {
    return `"dataSchema" is not an object`;
  }
  for (const [fieldName, fieldSpec] of Object.entries(record.dataSchema)) {
    if (
      !isPlainObject(fieldSpec) ||
      !DATA_FIELD_KINDS.includes(fieldSpec.kind as (typeof DATA_FIELD_KINDS)[number]) ||
      !DATA_FIELD_LEVELS.includes(fieldSpec.level as (typeof DATA_FIELD_LEVELS)[number])
    ) {
      return `"dataSchema.${fieldName}" is not a well-formed field spec (requires a valid "kind" and "level")`;
    }
  }
  return undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
