import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const hookSource = fs.readFileSync(path.join(__dirname, 'use-observability-live.tsx'), 'utf8');

test("loadEarlier uses the canonical day-window functions, no local floor math (AD-6)", () => {
  assert.match(
    hookSource,
    /from\s*["']@\/lib\/observability\/day-window["']/,
    "hook imports from the day-window module"
  );
  assert.ok(
    hookSource.includes('canLoadEarlier') && hookSource.includes('previousUtcDay'),
    "hook references both canLoadEarlier and previousUtcDay"
  );
  assert.doesNotMatch(
    hookSource,
    /function\s+isWithinRetention\b/,
    "hook does not declare its own isWithinRetention helper"
  );
  assert.doesNotMatch(
    hookSource,
    /export\s+function\s+isWithinRetention\b/,
    "hook does not export isWithinRetention"
  );
  assert.doesNotMatch(
    hookSource,
    /setUTCDate\(/,
    "hook does not do inline day arithmetic via setUTCDate"
  );
});
