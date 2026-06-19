import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const sparklineSource = fs.readFileSync(path.join(__dirname, 'rate-sparkline.tsx'), 'utf8');

test('sparkline gradient id is unique per instance (NFR-5)', () => {
  assert.match(
    sparklineSource,
    /useId\(\)/,
    "sparkline uses useId() to generate a unique gradient id per instance"
  );
  assert.doesNotMatch(
    sparklineSource,
    /id="sparklineFill"/,
    "sparkline does not hardcode the gradient id as 'sparklineFill'"
  );
});

test('sparkline positions points on a numeric time axis and stays un-animated (DD-4, AD-5, NFR-1)', () => {
  assert.ok(sparklineSource.includes('XAxis') && sparklineSource.includes('dataKey="t"') && sparklineSource.includes('type="number"'),
    'points positioned by time t, not array index');
  assert.ok(sparklineSource.includes('isAnimationActive={false}'), 'sparkline never animates');
});
