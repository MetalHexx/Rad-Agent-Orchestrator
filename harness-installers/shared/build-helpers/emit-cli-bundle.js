// emit-cli-bundle.js — Single-file ESM bundle of a CLI source root via esbuild.
// Installer-blind: source root and outfile path are parameters; chmod mode is
// a tunable knob with a sane default. Never creates intermediate dist/ folders
// (no-litter discipline). On Windows, chmod is silently a no-op.

import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

/**
 * @param {{ source: string, target: string, entryPoint?: string, mode?: number }} opts
 */
export async function emitCliBundle(opts) {
  const { source, target, mode = 0o755 } = opts;
  const entryPoint = opts.entryPoint ?? path.join(source, 'src', 'bin', 'radorch.ts');
  fs.mkdirSync(path.dirname(target), { recursive: true });

  // The CLI source contains a runtime fs-walk for cli/package.json (in
  // src/lib/package-version.ts) so it can recover its own version under both
  // Vitest and compiled-dist layouts. When the bundle is shipped inside a
  // plugin install there is no cli/package.json to find, so the walk throws.
  // Inline the version at bundle time so the bundle is self-contained.
  const plugins = [];
  let cliVersion;
  try {
    cliVersion = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8')).version;
  } catch { /* source has no package.json (e.g. synthetic test fixture) — skip inlining */ }
  if (cliVersion) {
    plugins.push({
      name: 'inline-cli-version',
      setup(b) {
        b.onLoad({ filter: /[\\/]package-version\.(ts|js)$/ }, async () => ({
          contents: `export function getCliVersion() { return ${JSON.stringify(cliVersion)}; }\n`,
          loader: 'ts',
        }));
      },
    });
  }

  await build({
    entryPoints: [entryPoint],
    // Pin the working directory to a fixed base (the cli source's parent) so the
    // bundle is byte-deterministic. esbuild labels bundled modules with paths
    // relative to absWorkingDir (default: process.cwd()) — purely cosmetic
    // `__commonJS`/comment labels, but they end up in the output bytes. Without
    // this pin, the same source produces different bytes depending on the cwd the
    // build was invoked from (repo root vs an `npm run -w <workspace>` cwd),
    // which would make the generated install manifests non-reproducible and
    // break the manifest-drift gate.
    absWorkingDir: path.dirname(source),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    outfile: target,
    // Shebang lets the bundle run directly on POSIX once chmod 0o755 is applied.
    // The createRequire shim gives esbuild's __require fallback a real require()
    // so bundled CJS deps (commander, inquirer) can resolve dynamic require()s
    // like require('node:events') instead of throwing "Dynamic require not supported".
    banner: {
      js: [
        '#!/usr/bin/env node',
        "import { createRequire as __cjsRequireHelper } from 'node:module';",
        'const require = __cjsRequireHelper(import.meta.url);',
      ].join('\n'),
    },
    logLevel: 'warning',
    plugins,
  });
  // esbuild's `banner` prepends without deduplicating against a shebang already
  // present at the top of the entry source. If both exist, line 2 ends up `#!…`
  // and Node's ESM loader rejects the file with SyntaxError (only line 1 is
  // stripped). Collapse the duplicate so the output is always single-shebang.
  const text = fs.readFileSync(target, 'utf8');
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  if (lines[0]?.startsWith('#!') && lines[1]?.startsWith('#!')) {
    lines.splice(1, 1);
    fs.writeFileSync(target, lines.join(newline));
  }
  try { fs.chmodSync(target, mode); } catch { /* Windows: no POSIX mode */ }
}
