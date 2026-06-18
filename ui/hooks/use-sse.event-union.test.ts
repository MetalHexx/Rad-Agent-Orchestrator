import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// EVENT_TYPES was moved to types/events.ts as the single source of truth (FR-14).
const src = readFileSync(join(__dirname, '..', 'types', 'events.ts'), 'utf-8');

test('EVENT_TYPES registers all nine SSE event types (FR-10, AD-5)', () => {
  const m = src.match(/export const EVENT_TYPES:\s*SSEEventType\[\]\s*=\s*\[([\s\S]*?)\]/);
  assert.ok(m, 'EVENT_TYPES array must be present in types/events.ts');
  const listed = m[1];
  for (const ev of ['connected', 'state_change', 'project_added', 'project_removed', 'heartbeat', 'registry_change', 'artifact_change', 'live_degraded', 'telemetry_rows']) {
    assert.match(listed, new RegExp(`["']${ev}["']`), `EVENT_TYPES must include ${ev}`);
  }
});
