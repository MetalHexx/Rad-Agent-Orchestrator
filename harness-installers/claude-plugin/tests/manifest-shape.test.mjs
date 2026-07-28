import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MANIFESTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../manifests');

test('every manifests/v*.json has version + files; each file has destinationPath, sourcePath, ownership', () => {
  const dir = MANIFESTS_DIR;
  const files = readdirSync(dir).filter((f) => /^v.+\.json$/.test(f));
  assert.ok(files.length >= 1, 'at least one committed per-version manifest');
  for (const f of files) {
    const m = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    assert.ok(typeof m.version === 'string', `${f}: top-level version`);
    assert.ok(Array.isArray(m.files), `${f}: files array`);
    for (const entry of m.files) {
      assert.ok(entry.destinationPath, `${f}: entry.destinationPath`);
      assert.ok(entry.sourcePath, `${f}: entry.sourcePath`);
      assert.ok(['installer-owned', 'user-config'].includes(entry.ownership),
        `${f}: entry.ownership must be 'installer-owned' or 'user-config'`);
    }
  }
});

test('orchestration.yml entry is ownership:user-config so upgrade skips removal', () => {
  const m = JSON.parse(fs.readFileSync(
    path.join(MANIFESTS_DIR, 'v1.0.0-alpha.10.json'), 'utf8'));
  const orch = m.files.find((e) => e.destinationPath === '${RAD_HOME}/orchestration.yml');
  assert.ok(orch, 'orchestration.yml entry present');
  assert.strictEqual(orch.ownership, 'user-config');
});
