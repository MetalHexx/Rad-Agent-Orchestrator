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
