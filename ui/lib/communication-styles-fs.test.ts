import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listStyleCatalog, resolveStyleCatalogRoot } from './communication-styles-fs';
import { withHomedir } from './test-helpers';

function seedRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-fs-'));
  fs.mkdirSync(path.join(root, 'custom'), { recursive: true });
  fs.writeFileSync(path.join(root, 'formal.md'),
    '---\nname: formal\ntitle: Formal\ndescription: A formal tone.\n---\n\nBody.\n');
  fs.writeFileSync(path.join(root, 'malformed.md'), '---\nname: malformed\n---\nincomplete\n');
  fs.writeFileSync(path.join(root, 'custom', 'my-style.md'),
    '---\nname: my-style\ntitle: My Style\ndescription: A custom style.\n---\n\nBody.\n');
  return root;
}

test('listStyleCatalog returns shipped and custom entries with a catalog-relative path', () => {
  const root = seedRoot();
  const entries = listStyleCatalog(root);
  const shipped = entries.find((e) => e.name === 'formal')!;
  assert.strictEqual(shipped.path, 'formal.md');
  assert.strictEqual(shipped.title, 'Formal');
  assert.strictEqual(shipped.isCustom, false);
  const custom = entries.find((e) => e.name === 'my-style')!;
  assert.strictEqual(custom.path, 'custom/my-style.md');
  assert.strictEqual(custom.title, 'My Style');
  assert.strictEqual(custom.isCustom, true);
});

test('listStyleCatalog skips an unparseable file with a console.warn', () => {
  const root = seedRoot();
  const originalWarn = console.warn;
  let warned = false;
  console.warn = () => { warned = true; };
  try {
    const entries = listStyleCatalog(root);
    assert.ok(!entries.some((e) => e.name === 'malformed'), 'malformed entry skipped');
    assert.ok(warned, 'expected console.warn for unparseable file');
  } finally {
    console.warn = originalWarn;
  }
});

test('listStyleCatalog returns [] for a missing catalog root', () => {
  const root = path.join(os.tmpdir(), 'cs-fs-missing-' + Math.random().toString(36).slice(2));
  assert.deepStrictEqual(listStyleCatalog(root), []);
});

test('listStyleCatalog returns shipped-only entries when custom/ is missing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-fs-nocustom-'));
  fs.writeFileSync(path.join(root, 'formal.md'),
    '---\nname: formal\ntitle: Formal\ndescription: A formal tone.\n---\n\nBody.\n');
  const entries = listStyleCatalog(root);
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].name, 'formal');
});

test('resolveStyleCatalogRoot honors a stubbed homedir (AD-9)', async () => {
  await withHomedir('/fake/home', () => {
    assert.strictEqual(resolveStyleCatalogRoot(), path.join('/fake/home', '.radorc', 'communication-styles'));
  });
});
