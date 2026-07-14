import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FORBIDDEN = ['plan_corrective', 'add_corrective_gate', 'replace_expansion'];

describe('anti-regression: removed audit machinery tokens', () => {
  it('scans all src trees and asserts none contain the three forbidden tokens', () => {
    // Resolve the repo root relative to this test file
    // graph-service/tests/anti-regression/removed-audit-machinery.test.ts -> repo root
    const testFile = fileURLToPath(import.meta.url);
    const testDir = path.dirname(testFile);
    const repoRoot = path.resolve(testDir, '../../..');

    // The three source roots to scan
    const srcRoots = [
      path.join(repoRoot, 'lib/graph-engine/src'),
      path.join(repoRoot, 'lib/graph-node-types/src'),
      path.join(repoRoot, 'graph-service/src'),
    ];

    const violations: Array<{ file: string; token: string }> = [];

    /**
     * Recursively walk a directory and check each .ts/.tsx file for forbidden tokens.
     */
    function walkDirectory(dir: string): void {
      // Skip excluded directories
      const basename = path.basename(dir);
      if (basename === 'node_modules' || basename === 'dist') {
        return;
      }

      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return; // Skip if directory can't be read
      }

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          walkDirectory(fullPath);
        } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
          // Read file and check for forbidden tokens
          const content = fs.readFileSync(fullPath, 'utf8');

          for (const token of FORBIDDEN) {
            if (content.includes(token)) {
              violations.push({
                file: fullPath,
                token,
              });
            }
          }
        }
      }
    }

    // Scan all three source roots
    for (const srcRoot of srcRoots) {
      walkDirectory(srcRoot);
    }

    // Assert no violations
    if (violations.length > 0) {
      const message = violations
        .map(({ file, token }) => `  - ${token} found in: ${file}`)
        .join('\n');
      expect.fail(`Forbidden tokens detected:\n${message}`);
    }
  });
});
