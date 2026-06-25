import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(__dirname, 'save-star-button.tsx'), 'utf8');

test('save star uses the outline icon-button form matching Refresh and Help controls (FR-3, DD-2)', () => {
  assert.ok(src.includes('variant="outline"'), 'Button uses variant="outline"');
  assert.ok(src.includes('size="icon"'), 'Button uses size="icon"');
  assert.ok(!src.includes('variant="ghost"'), 'does not use variant="ghost"');
  assert.ok(!src.includes('size="icon-xs"'), 'does not use size="icon-xs"');
});
