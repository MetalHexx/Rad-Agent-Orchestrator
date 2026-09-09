import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('GET /api/communication-styles returns styles shaped by listStyleCatalog', async () => {
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-route-home-'));
  const root = path.join(fakeHome, '.radorc', 'communication-styles');
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'formal.md'),
    '---\nname: formal\ntitle: Formal\ndescription: A formal tone.\n---\n\nbody\n');
  const origHomedir = os.homedir;
  (os as unknown as { homedir: () => string }).homedir = () => fakeHome;
  try {
    const mod = await import('./route');
    const res = await mod.GET();
    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(body.styles));
    assert.ok(body.styles.find((s: { name: string }) => s.name === 'formal'));
  } finally {
    (os as unknown as { homedir: () => string }).homedir = origHomedir;
  }
});

test('GET /api/communication-styles returns 500 when the read throws', async () => {
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-route-home-err-'));
  fs.mkdirSync(path.join(fakeHome, '.radorc'), { recursive: true });
  // Make the catalog root a file, not a directory, so readdirSync throws.
  fs.writeFileSync(path.join(fakeHome, '.radorc', 'communication-styles'), 'not a directory');
  const origHomedir = os.homedir;
  (os as unknown as { homedir: () => string }).homedir = () => fakeHome;
  try {
    const mod = await import('./route');
    const res = await mod.GET();
    assert.strictEqual(res.status, 500);
    const body = await res.json();
    assert.ok(typeof body.error === 'string');
  } finally {
    (os as unknown as { homedir: () => string }).homedir = origHomedir;
  }
});
