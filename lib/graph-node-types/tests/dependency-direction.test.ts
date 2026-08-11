// lib/graph-node-types/tests/dependency-direction.test.ts
//
// Dependency-direction invariant guard: `lib/graph-node-types` must depend only on
// `@rad-orchestration/graph-engine` and nothing else, as stated in its AGENTS.md.
// This guard enforces that rule: the manifest must declare exactly the engine as its sole
// production dependency, and no .ts file in src/ may import from any other package.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ALLOWED_PACKAGE = '@rad-orchestration/graph-engine';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(testDir, '../');

describe('dependency-direction: lib/graph-node-types depends only on graph-engine', () => {
  it('declares @rad-orchestration/graph-engine as its sole production dependency', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };

    expect(manifest.dependencies).toEqual({
      [ALLOWED_PACKAGE]: '1.0.0-alpha.13',
    });
  });

  it('has no src/ file importing from any package outside the allowed set', () => {
    // Pattern matches `from '…'` or `from "…"` but does not match `require.resolve(…)`,
    // following the service-side guard's shape. A dynamic `await import(...)` would escape this
    // regex, but that form is not yet used in the codebase; the gap is noted here rather than
    // contorted to avoid false positives.
    const importPattern = new RegExp(`from\\s+['"](?!node:)[^'"]`);
    const offenders: string[] = [];

    function walk(dir: string): void {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile() && entry.name.endsWith('.ts')) {
          const content = fs.readFileSync(full, 'utf8');
          if (!importPattern.test(content)) continue;

          // Found a potential import; now parse it more carefully to check if it's forbidden.
          // Extract all imports of the form `from '...'` or `from "..."`
          const imports = content.match(/from\s+['"]([^'"]+)['"]/g) || [];
          for (const importStatement of imports) {
            const match = importStatement.match(/from\s+['"]([^'"]+)['"]/);
            if (!match) continue;
            const pkgName = match[1];
            // Built-in modules start with 'node:'; allowed imports come from the allowed package
            if (pkgName.startsWith('node:') || pkgName === ALLOWED_PACKAGE || pkgName.startsWith(`${ALLOWED_PACKAGE}/`)) {
              continue;
            }
            // Relative imports are fine (e.g., './other-file', '../sibling')
            if (pkgName.startsWith('.')) continue;
            // If we get here, it's a forbidden external package import
            offenders.push(`${full}: ${importStatement}`);
          }
        }
      }
    }

    walk(path.join(pkgRoot, 'src'));
    expect(offenders).toEqual([]);
  });
});
