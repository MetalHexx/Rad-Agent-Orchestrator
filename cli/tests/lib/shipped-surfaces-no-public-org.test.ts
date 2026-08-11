import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * Walk a directory and collect all file paths (excluding specified directories).
 */
function walk(dir: string, acc: string[] = [], exclude: Set<string> = new Set()): string[] {
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (exclude.has(e.name)) continue;
      if (e.isDirectory()) walk(abs, acc, exclude);
      else acc.push(abs);
    }
  } catch {
    // Skip directories that cannot be read (e.g., permission errors)
  }
  return acc;
}

/**
 * Read a file and check if it contains a token (case-insensitive).
 */
function fileContainsToken(filePath: string, token: string): boolean {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return new RegExp(token, 'i').test(content);
  } catch {
    return false;
  }
}

describe('shipped surfaces contain no references to public org', () => {
  it('does not contain metalhexx in shipped surfaces', () => {
    const token = 'metalhexx';
    const offenders: string[] = [];

    // Resolve paths to scan
    const pathsToScan = [
      // Plugin manifests (three plugin manifests in harness-installers)
      path.join(repoRoot, 'harness-installers/claude-plugin/.claude-plugin/plugin.json'),
      path.join(repoRoot, 'harness-installers/copilot-cli-plugin/plugin.json'),
      path.join(repoRoot, 'harness-installers/copilot-vscode-plugin/.claude-plugin/plugin.json'),
      // Docs (top level only, excluding internals)
      path.join(repoRoot, 'docs'),
      // Standard installer surfaces
      path.join(repoRoot, 'harness-installers/standard/lib'),
      path.join(repoRoot, 'harness-installers/standard/package.json'),
      // Agent/skill files
      path.join(repoRoot, '.agents'),
    ];

    // Directories to exclude globally
    const excludeGlobal = new Set(['node_modules', '.git', 'dist', 'build', 'output']);

    for (const scanPath of pathsToScan) {
      if (!fs.existsSync(scanPath)) continue;

      const isFile = fs.statSync(scanPath).isFile();
      if (isFile) {
        // For file paths, check the file directly
        if (fileContainsToken(scanPath, token)) {
          offenders.push(scanPath);
        }
      } else {
        // For directory paths, walk and check all files
        const files = walk(scanPath, [], excludeGlobal);

        for (const file of files) {
          // Skip changelog and tests
          if (file.includes('CHANGELOG.md') || file.includes('/cli/tests/')) continue;
          // Skip docs/internals
          if (file.includes('docs/internals/') || file.includes('docs\\internals\\')) continue;

          if (fileContainsToken(file, token)) {
            offenders.push(file);
          }
        }
      }
    }

    if (offenders.length > 0) {
      const offenderList = offenders.map((p) => p.replace(repoRoot, '.')).join('\n  ');
      expect.fail(`Found '${token}' in shipped surfaces:\n  ${offenderList}`);
    }
  });
});
