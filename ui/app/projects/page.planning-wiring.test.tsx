import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Source-shape assertions for the P03-T01 Planning-section integration. The
// page's data-fetching effects are not SSR-safe under node --test, so the
// wiring is pinned by inspecting the source text (the established pattern for
// this page — see page.test.tsx / page.modal-wiring.test.tsx).
const pageSrc = readFileSync(
  path.join(process.cwd(), 'app', 'projects', '[[...slug]]', 'page.tsx'),
  'utf-8',
);

test('the active branch mounts <PlanningSection> in place of <BrainstormingSection>', () => {
  assert.ok(pageSrc.includes('<PlanningSection'), 'page mounts the unified Planning section');
  assert.ok(!pageSrc.includes('BrainstormingSection'), 'the legacy BrainstormingSection mount is gone');
});

test('PlanningSection is imported from the planning-section module', () => {
  assert.ok(
    /import\s*\{\s*PlanningSection\s*\}\s*from\s*["']@\/components\/planning-section["']/.test(pageSrc),
    'PlanningSection imported by name from @/components/planning-section',
  );
});

test('the card inputs are threaded from live state into PlanningSection', () => {
  const idx = pageSrc.indexOf('<PlanningSection');
  assert.ok(idx >= 0, '<PlanningSection must be present');
  const mount = pageSrc.slice(idx, pageSrc.indexOf('/>', idx));
  assert.ok(/state=\{v5State\}/.test(mount), 'live state fed to the card');
  assert.ok(/compareUrlByRepo=\{v5Derivations\.compareUrlByRepo\}/.test(mount), 'compare URLs threaded');
  assert.ok(/onDocClick=\{openArtifactModal\}/.test(mount), 'doc-click handler threaded to the modal opener');
  assert.ok(/requirementsStatus=\{requirementsStatus\}/.test(mount), 'requirements status threaded to the docs list');
});

test('requirementsStatus is captured from the existing /files fetch (its client origin is pinned here)', () => {
  assert.ok(/setRequirementsStatus/.test(pageSrc), 'a requirementsStatus state setter exists');
  assert.ok(
    /requirementsStatus\?\s*:\s*string\s*\|\s*null/.test(pageSrc),
    'the /files response type is widened to carry requirementsStatus',
  );
  assert.ok(
    /setRequirementsStatus\(data\.requirementsStatus/.test(pageSrc),
    'the status is read off the files response payload',
  );
});

test('the not-started and skeleton branches are preserved untouched', () => {
  assert.ok(pageSrc.includes('LaunchScreen'), 'the not-started LaunchScreen branch remains');
  assert.ok(pageSrc.includes('<DAGTimelineSkeleton'), 'the loading skeleton branch remains');
  assert.ok(
    /tier === ['"]not_initialized['"]/.test(pageSrc),
    'the not_initialized branch condition is intact',
  );
});
