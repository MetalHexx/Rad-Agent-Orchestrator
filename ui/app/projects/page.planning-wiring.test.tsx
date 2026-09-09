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

test('requirementsStatus is sourced from the live artifact context, not a standalone fetch (P03-T02)', () => {
  assert.ok(!/setRequirementsStatus/.test(pageSrc), 'the standalone requirementsStatus state setter is gone');
  assert.ok(
    !/requirementsStatus\?\s*:\s*string\s*\|\s*null/.test(pageSrc),
    'the /files response type in this page no longer carries requirementsStatus (it lives in the live snapshot)',
  );
  assert.ok(
    /const requirementsStatus = live\.requirementsStatus/.test(pageSrc),
    'requirementsStatus is read off the live artifact context',
  );
});

test('the not-started and skeleton branches are preserved untouched', () => {
  assert.ok(pageSrc.includes('<OverviewPage'), 'the not-started branch now mounts the Overview (P03-T03)');
  assert.ok(pageSrc.includes('<DAGTimelineSkeleton'), 'the loading skeleton branch remains');
  assert.ok(
    /case 'launch'/.test(pageSrc),
    'the not-started case is still reachable, now as the launch view',
  );
});

test("the 'plan' branch renders the Overview or the DAG depending on viewMode, once the snapshot has loaded (P03-T03)", () => {
  const planIdx = pageSrc.indexOf("case 'plan':");
  const launchIdx = pageSrc.indexOf("case 'launch':");
  assert.ok(planIdx >= 0 && launchIdx > planIdx, "both branches present, in order");
  const planBody = pageSrc.slice(planIdx, launchIdx);
  assert.ok(/viewMode === ['"]overview['"][\s\S]*?<OverviewPage/.test(planBody), 'the overview mode mounts <OverviewPage>');
  assert.ok(/<PlanningSection/.test(planBody) && /<DAGTimeline/.test(planBody), 'the pipeline mode still mounts PlanningSection + DAGTimeline');
});

test("the 'launch' branch always renders the Overview and never consults viewMode for its own routing (P03-T03)", () => {
  const launchIdx = pageSrc.indexOf("case 'launch':");
  assert.ok(launchIdx >= 0, "the launch branch is present");
  const launchBody = pageSrc.slice(launchIdx, pageSrc.indexOf('}\n  }', launchIdx));
  assert.ok(/<OverviewPage/.test(launchBody), 'the launch branch mounts <OverviewPage>');
  assert.ok(!/viewMode\s*===/.test(launchBody), 'the launch branch never branches on viewMode itself');
});

test("the 'launch' branch renders a ProjectHeader with no toggle and threads the project-delete control (P03-T03)", () => {
  const launchIdx = pageSrc.indexOf("case 'launch':");
  const headerIdx = pageSrc.indexOf('<ProjectHeader', launchIdx);
  assert.ok(headerIdx > launchIdx, 'the launch branch mounts a ProjectHeader (it had none before this task)');
  const headerMount = pageSrc.slice(headerIdx, pageSrc.indexOf('/>', headerIdx));
  assert.ok(/viewMode=\{undefined\}/.test(headerMount), 'viewMode is explicitly undefined so no toggle renders');
  assert.ok(/onRequestDelete=\{onRequestDelete\}/.test(headerMount), "the header's delete control reaches the same handler the plan branch uses");
});
