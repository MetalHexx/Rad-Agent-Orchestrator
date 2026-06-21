import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, 'observability-view.tsx'), 'utf8');

test('chartData useMemo lists range and effectiveTick in its dependency array (NFR-6, AD-11, FR-11)', () => {
  // The chartData memo reads `range` and `effectiveTick` via
  // bucketsForWindow(windowMsForBuckets(range, effectiveTick)); React's exhaustive-deps
  // rule requires every closed-over reactive value to appear in the dependency array.
  // The data source is `chartRows` (extracted into its own memo from filteredSessions)
  // which transitively tracks filtered sessions, rows, and the window bounds.
  assert.match(
    src,
    /const chartData = React\.useMemo\([\s\S]*?\[\s*chartRows,\s*rangeEnd,\s*range,\s*effectiveTick\s*\]\s*\)/,
    'chartData dependency array must be [chartRows, rangeEnd, range, effectiveTick]'
  );
});
