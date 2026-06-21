import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const src = readFileSync(path.join(process.cwd(), 'components', 'ui', 'back-button.tsx'), 'utf-8');

test('ghost icon button — no chrome at rest, hand cursor on hover', () => {
  assert.match(src, /variant="ghost"/, 'ghost = transparent at rest, highlight only on hover');
  assert.match(src, /cursor-pointer/, 'hand (pointer) cursor on hover');
});

test('uses a compact ChevronLeft from lucide (mockup Variant C)', () => {
  assert.match(src, /from "lucide-react"/);
  assert.match(src, /<ChevronLeft/);
});

test('pure browser-back — no router, no fallback, SSR-guarded', () => {
  assert.match(src, /window\.history\.back\(\)/, 'pure strict browser-back');
  assert.doesNotMatch(src, /useRouter/, 'no Next router dependency (stays SSR-renderable)');
  assert.match(src, /typeof window/, 'guards history access for SSR');
});

test('carries an accessible label', () => {
  assert.match(src, /aria-label/, 'aria-label (default + override)');
});
