// graph-service/src/node-types/populate-builtin.ts — the dev-seed-only step that stages the
// `rad-orc` built-in package's `manifest.yml` + built `dist/` tree onto disk at
// `<root>/node-types/builtin/rad-orc/`, so `discoverNodeTypes`'s `builtin/` bucket has real
// artifacts to scan. Sourced from `@rad-orchestration/graph-node-types`'s own package root,
// resolved via `require.resolve` against its `"."` export rather than a workspace-relative path,
// so this works the same in a dev monorepo checkout and a real npm install. The production
// installer that deploys built-ins to a real machine is a later iteration (It. 4) — this only
// feeds the dev-seed path node-type discovery is proven against here. `graph-service` itself no
// longer depends on `@rad-orchestration/graph-node-types` (its `package.json` deliberately omits
// it), so a standalone install won't have the package on disk to resolve — that's expected outside
// a monorepo checkout, and is treated as "nothing to stage" rather than a hard failure.
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';

const BUILT_IN_PACKAGE_SPECIFIER = '@rad-orchestration/graph-node-types';

const require = createRequire(import.meta.url);

function isModuleNotFound(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND' &&
    error.message.includes(BUILT_IN_PACKAGE_SPECIFIER)
  );
}

/**
 * Resolves `@rad-orchestration/graph-node-types`'s package root: `require.resolve` follows its
 * `"."` export to `dist/index.js`, two directories up from which is the package root that also
 * holds `manifest.yml` and the rest of `dist/`. Returns `null` — rather than throwing — when the
 * package isn't resolvable at all, which is the expected shape of a standalone (non-monorepo)
 * install that never had it as a dependency.
 */
function resolveBuiltinPackageRoot(): string | null {
  try {
    const indexPath = require.resolve(BUILT_IN_PACKAGE_SPECIFIER);
    return path.dirname(path.dirname(indexPath));
  } catch (error) {
    if (isModuleNotFound(error)) return null;
    throw error;
  }
}

/** Excludes `.d.ts` declaration files — the loader only ever dynamic-imports the built `.js`
 *  (`.js.map` is kept alongside it, matching the package's own `dist/` shape exactly). */
function isRunnableArtifact(source: string): boolean {
  return !source.endsWith('.d.ts');
}

/**
 * Copies the `rad-orc` built-in package's `manifest.yml` and built `dist/` tree into
 * `<root>/node-types/builtin/rad-orc/`, replacing any prior copy first — idempotent, so re-seeding
 * never accumulates stale artifacts alongside a fresh build's output. A no-op (not an error) when
 * `@rad-orchestration/graph-node-types` isn't resolvable — `discoverNodeTypes` then simply sees
 * whatever's already staged in `builtin/` (nothing, on a fresh standalone install).
 */
export async function populateBuiltinNodeTypes(root: string): Promise<void> {
  const packageRoot = resolveBuiltinPackageRoot();
  if (packageRoot === null) return;

  const dest = path.join(root, 'node-types', 'builtin', 'rad-orc');

  await fs.rm(dest, { recursive: true, force: true });
  await fs.mkdir(dest, { recursive: true });
  await fs.copyFile(path.join(packageRoot, 'manifest.yml'), path.join(dest, 'manifest.yml'));
  await fs.cp(path.join(packageRoot, 'dist'), path.join(dest, 'dist'), {
    recursive: true,
    filter: isRunnableArtifact,
  });
}
