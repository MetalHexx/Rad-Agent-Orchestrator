// emit-hook-bundle.js — Plugin-specific by nature, but lives in shared/
// for discipline-consistency with the other emit-helpers. Bundles
// bootstrap.mjs with deps inlined, copies drift-check.mjs / hooks.json /
// launcher.cjs / hooks/AGENTS.md verbatim from `source`, and stages the
// single-source session-preamble.mjs + telemetry-capture.mjs shims from
// `sharedHooksDir` (AD-8).

import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

/**
 * @param {{ source: string, target: string, sharedHooksDir?: string }} opts
 *  - source: hooks/ folder containing bootstrap.mjs + drift-check.mjs +
 *    hooks.json + launcher.cjs + AGENTS.md
 *  - target: output hooks/ folder under the installer's output/
 *  - sharedHooksDir: the canonical shared hooks/ folder that owns the
 *    single-source session-preamble.mjs + telemetry-capture.mjs shims (AD-8).
 *    When provided, the shims are staged from here, not from the plugin
 *    `source` tree. Falls back to `source` when absent (backward compatibility).
 *
 * esbuild resolves bootstrap.mjs's `../lib/install/*` imports naturally from
 * the entry's own location, so no explicit libRoot parameter is needed.
 */
export async function emitHookBundle(opts) {
  const { source, target, sharedHooksDir } = opts;
  fs.mkdirSync(target, { recursive: true });
  const bootstrapEntry = path.join(source, 'bootstrap.mjs');
  const bootstrapOut = path.join(target, 'bootstrap.mjs');
  // esbuild preserves the source's shebang automatically; do NOT add one via
  // banner — that yielded a double shebang (banner + source) and Node
  // rejected line 2 as a SyntaxError when the hook fired. Source's shebang
  // is the single source of truth.
  await build({
    entryPoints: [bootstrapEntry],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    outfile: bootstrapOut,
    logLevel: 'warning',
  });
  // Per-plugin verbatim files copied from the plugin's own hooks/ tree.
  for (const verbatim of ['drift-check.mjs', 'hooks.json', 'launcher.cjs', 'AGENTS.md']) {
    const src = path.join(source, verbatim);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(target, verbatim));
    }
  }
  // session-preamble.mjs + telemetry-capture.mjs are single-source (AD-8).
  const shimSource = sharedHooksDir ?? source;
  for (const shim of ['session-preamble.mjs', 'telemetry-capture.mjs']) {
    const src = path.join(shimSource, shim);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(target, shim));
  }
}
