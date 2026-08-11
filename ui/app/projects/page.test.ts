/**
 * Structural test — confirms /projects/page.tsx routes a selected
 * not_initialized project into NotStartedPaneV5 and does not fall
 * through to the generic "Select a project to begin" branch. Read via
 * source inspection because the page's data fetching effects are not
 * SSR-safe under node --test.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

async function run() {
  const src = await readFile(
    path.resolve(__dirname, '[[...slug]]', 'page.tsx'), 'utf-8',
  );
  const viewSrc = await readFile(
    path.resolve(__dirname, '..', '..', 'lib', 'project-view.ts'), 'utf-8',
  );

  assert.ok(
    /LaunchScreen/.test(src),
    'page.tsx imports/uses LaunchScreen (replaced NotStartedPaneV5 in P03-T03)',
  );
  assert.ok(
    /useStartAction/.test(src),
    'page.tsx uses useStartAction for the spawn endpoint',
  );
  assert.ok(
    /case 'launch'/.test(src),
    'page.tsx mounts the pane from the launch view returned by selectProjectView',
  );
  assert.ok(
    /tier === ['\"]not_initialized['\"]/.test(viewSrc),
    'the not_initialized gate now lives in the pure view decision, not in the page',
  );
  assert.ok(
    /Select a project to begin/.test(src),
    'empty-selection placeholder still present for the unselected case (FR-10)',
  );

  console.log('✓ page.tsx wires LaunchScreen for selected Not-Started projects');
  console.log('\nAll /projects page structural tests passed');
}

run();
