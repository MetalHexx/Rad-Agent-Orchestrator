import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(__dirname, 'save-star-button.tsx'), 'utf8');

test('save star is a borderless ghost icon button with a --live glow when saved', () => {
  assert.ok(src.includes('variant="ghost"'), 'Button uses variant="ghost" (no outline box)');
  assert.ok(src.includes('size="icon"'), 'Button uses size="icon"');
  assert.ok(!src.includes('variant="outline"'), 'no longer uses the boxed outline form');
  assert.ok(src.includes('text-[var(--live)]'), 'saved state uses the --live red glow');
  assert.match(src, /fill=\{saved \? "currentColor" : "none"\}/, 'star fills only when saved');
});
