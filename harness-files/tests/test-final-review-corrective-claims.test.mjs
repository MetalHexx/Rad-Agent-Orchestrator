import { test } from 'node:test';
import assert from 'node:assert';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');

const FORBIDDEN_TOKENS = [
  'no corrective cycle',
  'strict-and-final',
  'strict and final',
  'strict and terminal',
  'authoring subagent',
  'add phases or tasks',
];

const SKIP_PATTERNS = [
  /node_modules/,
  /dist/,
  /output/,
  /dogfood-marketplace/,
  /\.claude/,
  /\.github/,
];

function shouldSkipPath(filePath) {
  return SKIP_PATTERNS.some(pattern => pattern.test(filePath));
}

function walkDirectory(dir, callback) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (shouldSkipPath(fullPath)) continue;
    if (entry.isDirectory()) {
      walkDirectory(fullPath, callback);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      callback(fullPath);
    }
  }
}

test('no forbidden corrective-cycle claims in canonical source', () => {
  const offenders = [];

  // Deliberately excludes the repo root and `ui/` AGENTS.md files: both carry
  // legitimate uses of this vocabulary elsewhere in the same files (e.g. the
  // root's per-module ownership prose, the UI's own state/badge language), so
  // a corpus-wide token would trip over them. Their amendment-surface sections
  // are covered by review instead, the same way the merge core's `.ts`
  // doc-comments are.
  const diresToScan = [
    join(repoRoot, 'harness-files', 'skills'),
    join(repoRoot, 'runtime-config', 'action-events'),
    join(repoRoot, 'docs'),
  ];

  for (const dir of diresToScan) {
    walkDirectory(dir, (filePath) => {
      const content = readFileSync(filePath, 'utf8');
      const lines = content.split('\n');

      lines.forEach((line, lineIndex) => {
        const lowerLine = line.toLowerCase();
        for (const token of FORBIDDEN_TOKENS) {
          if (lowerLine.includes(token.toLowerCase())) {
            const relPath = path.relative(repoRoot, filePath);
            offenders.push({
              file: relPath,
              line: lineIndex + 1,
              content: line.trim(),
              token,
            });
          }
        }
      });
    });
  }

  if (offenders.length > 0) {
    const msg = offenders
      .map((o) => `  ${o.file}:${o.line} — forbidden token "${o.token}"\n    > ${o.content}`)
      .join('\n');
    assert.fail(`Found forbidden corrective-cycle claims:\n${msg}`);
  }
});
