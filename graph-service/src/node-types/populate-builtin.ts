// graph-service/src/node-types/populate-builtin.ts — the dev-seed-only step that stages the
// `rad-orc` built-in package's `manifest.yml` + built `dist/` tree onto disk at
// `<root>/node-types/builtin/rad-orc/`, so `discoverNodeTypes`'s `builtin/` bucket has real
// artifacts to scan. Sourced from `@rad-orchestration/graph-node-types`'s own package root,
// resolved via `require.resolve` against its `"."` export rather than a workspace-relative path,
// so this works the same in a dev monorepo checkout and a real npm install. The production
// installer that deploys built-ins to a real machine is a later iteration (It. 4) — this only
// feeds the dev-seed path node-type discovery is proven against here.
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);

/**
 * Resolves `@rad-orchestration/graph-node-types`'s package root: `require.resolve` follows its
 * `"."` export to `dist/index.js`, two directories up from which is the package root that also
 * holds `manifest.yml` and the rest of `dist/`.
 */
function resolveBuiltinPackageRoot(): string {
  const indexPath = require.resolve('@rad-orchestration/graph-node-types');
  return path.dirname(path.dirname(indexPath));
}

/** Excludes `.d.ts` declaration files — the loader only ever dynamic-imports the built `.js`
 *  (`.js.map` is kept alongside it, matching the package's own `dist/` shape exactly). */
function isRunnableArtifact(source: string): boolean {
  return !source.endsWith('.d.ts');
}

/**
 * Copies the `rad-orc` built-in package's `manifest.yml` and built `dist/` tree into
 * `<root>/node-types/builtin/rad-orc/`, replacing any prior copy first — idempotent, so re-seeding
 * never accumulates stale artifacts alongside a fresh build's output.
 */
export async function populateBuiltinNodeTypes(root: string): Promise<void> {
  const packageRoot = resolveBuiltinPackageRoot();
  const dest = path.join(root, 'node-types', 'builtin', 'rad-orc');

  await fs.rm(dest, { recursive: true, force: true });
  await fs.mkdir(dest, { recursive: true });
  await fs.copyFile(path.join(packageRoot, 'manifest.yml'), path.join(dest, 'manifest.yml'));
  await fs.cp(path.join(packageRoot, 'dist'), path.join(dest, 'dist'), {
    recursive: true,
    filter: isRunnableArtifact,
  });
}
