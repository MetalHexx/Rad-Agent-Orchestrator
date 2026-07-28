import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MANIFESTS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '../../manifests');
const HARNESSES = ['claude', 'copilot-cli', 'copilot-vscode'];

for (const h of HARNESSES) {
  const file = path.join(MANIFESTS, h, 'v1.0.0-alpha.11.json');
  test(`${h} manifest has no rad-execute-parallel entry (FR-18, NFR-3)`, () => {
    const m = JSON.parse(fs.readFileSync(file, 'utf8'));
    const bad = m.files.filter((e) =>
      e.bundlePath.includes('skills/rad-execute-parallel'));
    assert.strictEqual(bad.length, 0,
      `${h}: no skills/rad-execute-parallel/* entries may survive`);
  });

  test(`${h} manifest carries rad-execute SKILL.md entry (FR-18, AD-4)`, () => {
    const m = JSON.parse(fs.readFileSync(file, 'utf8'));
    const exec = m.files.find((e) =>
      e.bundlePath === 'skills/rad-execute/SKILL.md');
    assert.ok(exec, `${h}: skills/rad-execute/SKILL.md entry present`);
    assert.strictEqual(exec.destinationPath,
      '${HARNESS_ROOT}/skills/rad-execute/SKILL.md',
      `${h}: rad-execute SKILL.md installs under the per-harness root`);
  });
}
