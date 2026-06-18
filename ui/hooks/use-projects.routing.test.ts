import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Pins the navigation mechanism for PROJECT selection. `selectProject` must drive
// the URL with window.history.pushState — NOT router.push. router.push re-keys the
// [[...slug]] segment, remounting the entire ProjectsPage subtree (including the
// sidebar). That remount re-runs ProjectSidebar's local useState("") and wipes the
// "Filter projects…" search text (the filter-clears-on-select bug), and refetches
// (the "full page reload" jank). This mirrors the in-modal doc-nav contract pinned
// in app/projects/page.modal-wiring.test.tsx. Don't revert to router-based project nav.

const hookSrc = readFileSync(path.join(process.cwd(), 'hooks', 'use-projects.ts'), 'utf-8');

const selectIdx = hookSrc.indexOf('const selectProject = useCallback');
// Slice from the declaration to the end of its dependency array (`}, [`), so the
// assertions inspect only the selectProject body.
const selectBody = hookSrc.slice(selectIdx, hookSrc.indexOf('}, [', selectIdx));

test('selectProject drives the URL via window.history.pushState (shallow, no remount)', () => {
  assert.ok(selectIdx >= 0, 'selectProject is defined with useCallback');
  assert.ok(
    /window\.history\.pushState\(/.test(selectBody),
    'selectProject must update the URL with window.history.pushState (preserves the sidebar filter)',
  );
});

test('selectProject must NOT use router.push/replace (would remount and reset the sidebar filter)', () => {
  assert.ok(
    !/router\.(push|replace)\(/.test(selectBody),
    'selectProject must not call router.push/replace — re-keying [[...slug]] remounts the page',
  );
});

test('use-projects no longer imports or instantiates useRouter (project nav is shallow)', () => {
  assert.ok(
    !/useRouter/.test(hookSrc),
    'useRouter should be gone from use-projects.ts — selection uses window.history.pushState',
  );
});
