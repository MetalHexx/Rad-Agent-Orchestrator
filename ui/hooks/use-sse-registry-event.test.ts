import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));

test('use-sse EVENT_TYPES allowlist includes registry_change (AD-8)', () => {
  // EVENT_TYPES was moved to types/events.ts as the single source of truth (FR-14).
  // Verify the canonical definition in that file contains registry_change.
  const src = readFileSync(path.join(dir, '..', 'types', 'events.ts'), 'utf8');
  const m = src.match(/export const EVENT_TYPES[^=]*=\s*\[([\s\S]*?)\]/);
  assert.ok(m, 'EVENT_TYPES export must be present in types/events.ts');
  assert.match(m[1], /["']registry_change["']/);
});

test('events.ts declares registry_change in the type union and payload map (AD-8)', () => {
  const src = readFileSync(path.join(dir, '..', 'types', 'events.ts'), 'utf8');
  assert.match(src, /\|\s*['"]registry_change['"]/);
  assert.match(src, /registry_change:\s*Record<string, never>/);
});
