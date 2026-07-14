// Anti-regression: the dependency-direction invariant P04 establishes. The production service host
// composes its whole registry from on-disk discovery (`node-types/scan.ts`), so it must not declare
// `@rad-orchestration/graph-node-types` as a package dependency, and no `src/` file may import it —
// the built-ins are loaded from disk, never pulled from that package. (The dev-seed's
// `populate-builtin.ts` still `require.resolve`s the package to *stage* its built artifacts onto
// disk; that is a resolve, not an `import ... from`, and is intentionally not a runtime coupling.)
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FORBIDDEN_PACKAGE = '@rad-orchestration/graph-node-types';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const serviceRoot = path.resolve(testDir, '../..');

describe('anti-regression: graph-service does not depend on graph-node-types', () => {
  it('declares no dependency on it in package.json (neither dependencies nor devDependencies)', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(serviceRoot, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(manifest.dependencies ?? {}).not.toHaveProperty(FORBIDDEN_PACKAGE);
    expect(manifest.devDependencies ?? {}).not.toHaveProperty(FORBIDDEN_PACKAGE);
  });

  it('has no src/ file importing built-ins from the package', () => {
    const importPattern = new RegExp(`from\\s+['"]${FORBIDDEN_PACKAGE.replace(/[/-]/g, '\\$&')}['"]`);
    const offenders: string[] = [];

    function walk(dir: string): void {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile() && entry.name.endsWith('.ts')) {
          if (importPattern.test(fs.readFileSync(full, 'utf8'))) offenders.push(full);
        }
      }
    }

    walk(path.join(serviceRoot, 'src'));
    expect(offenders).toEqual([]);
  });
});
