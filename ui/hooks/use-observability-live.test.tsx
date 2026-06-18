import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWithinRetention } from './use-observability-live';

const FIXED_NOW = Date.parse("2026-06-18T12:00:00Z");
const TODAY = "2026-06-18";
const EDGE_14 = "2026-06-04"; // 14 days before 2026-06-18
const BEYOND_14 = "2026-06-03"; // 15 days before 2026-06-18

test("isWithinRetention floors backward paging at the 14-day edge (AD-6)", () => {
  assert.equal(isWithinRetention(TODAY, FIXED_NOW), true, "today is within retention");
  assert.equal(isWithinRetention(EDGE_14, FIXED_NOW), true, "exactly 14 days ago is within retention (inclusive edge)");
  assert.equal(isWithinRetention(BEYOND_14, FIXED_NOW), false, "15 days ago is outside retention");
});
