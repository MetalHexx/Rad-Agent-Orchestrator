import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dotFreshness, dotRestingColor, isActive, DECAY_WINDOW_MS } from './activity-dot-color';

test('freshness is 1 at the instant of activity and 0 at/after the 5-min window (DD-7)', () => {
  assert.equal(dotFreshness(0), 1);
  assert.equal(dotFreshness(DECAY_WINDOW_MS), 0);
  assert.equal(dotFreshness(DECAY_WINDOW_MS * 2), 0);
  assert.ok(Math.abs(dotFreshness(DECAY_WINDOW_MS / 2) - 0.5) < 1e-9);
});

test('resting color interpolates --live-accent toward --muted-foreground via tokens (DD-7, NFR-2)', () => {
  assert.match(dotRestingColor(0), /var\(--live-accent\) 100%/);
  assert.match(dotRestingColor(0), /var\(--muted-foreground\)/);
  assert.match(dotRestingColor(DECAY_WINDOW_MS), /var\(--live-accent\) 0%/);
});

test('isActive is true within the decay window, false at/after it (FR-12)', () => {
  assert.equal(isActive(0), true);
  assert.equal(isActive(DECAY_WINDOW_MS - 1), true);
  assert.equal(isActive(DECAY_WINDOW_MS), false);
});

test('DECAY_WINDOW_MS is the single canonical export from sessions (FR-2)', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const src = fs.readFileSync(path.resolve(import.meta.dirname, 'activity-dot-color.ts'), 'utf8');
  assert.match(src, /import\s*\{[^}]*\bDECAY_WINDOW_MS\b[^}]*\}\s*from\s*["']\.\/sessions["']/,
    'activity-dot-color.ts must import DECAY_WINDOW_MS from ./sessions');
  assert.doesNotMatch(src, /export\s+const\s+DECAY_WINDOW_MS\b/,
    'activity-dot-color.ts must not declare its own DECAY_WINDOW_MS');
});
