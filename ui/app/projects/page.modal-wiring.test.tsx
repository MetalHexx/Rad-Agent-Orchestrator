import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  markdownPathForActive,
  fileNameAtOffset,
  fileNameAfterDelete,
} from '@/hooks/use-artifact-modal';
import type { ModalDoc } from '@/lib/modal-doc-model';

// Mirrors the page's wiring: the LaunchScreen/PlanningSection tiles are still
// root-only Artifact[] (index -> fileName at the call site), but the modal
// itself is driven by the unified ModalDoc[] list, keyed by path.

const arts: ModalDoc[] = [
  { path: 'DEMO-BRAINSTORMING.md', kind: 'markdown', title: 'Brainstorm', isMarkdown: true },
  { path: 'DEMO-BRAINSTORM.html', kind: 'visual', title: 'Brainstorm Visual', isMarkdown: false },
  { path: 'DEMO-WIREFRAME-X.html', kind: 'wireframe', title: 'X', isMarkdown: false },
];

const pageSrc = readFileSync(path.join(process.cwd(), 'app', 'projects', '[[...slug]]', 'page.tsx'), 'utf-8');

test('open converts the child index to a filename at the call site (open-by-filename)', () => {
  // BrainstormingSection/LaunchScreen still hand up an index; the page turns it
  // into the filename it opens the modal with.
  assert.ok(
    pageSrc.includes('openArtifactModal(artifacts[index].fileName)'),
    'page converts the incoming index to a filename before opening the modal',
  );
  // And the modal opener is the filename-based entry point.
  assert.ok(pageSrc.includes('openArtifactModal = modal.openByName'), 'opener is openByName');
});

test('the modal is driven by activePath, not an index (single choke point)', () => {
  assert.ok(pageSrc.includes('activePath={modal.activePath}'), 'modal receives the active path');
  assert.ok(!/activeIndex=\{/.test(pageSrc), 'no activeIndex prop is passed anymore');
  assert.ok(pageSrc.includes('const activePath = modal.activePath'), 'active path is the hook identity');
});

test('the render guard checks the active path is still in the list (FR-19)', () => {
  assert.ok(
    pageSrc.includes('modalDocs.some((d) => d.path === modal.activePath)'),
    'guard presence-checks by path, not by index',
  );
});

test('select forwards a path to the modal (select-by-path)', () => {
  assert.ok(pageSrc.includes('onSelect={(path) => modal.openByName(path)}'), 'onSelect re-opens by path');
});

test('prev/next are wired to the path-based navigation handlers (FR-14)', () => {
  assert.ok(pageSrc.includes('onPrev={modal.goPrev}'), 'prev wired');
  assert.ok(pageSrc.includes('onNext={modal.goNext}'), 'next wired');
  // The handlers themselves step by the active path's current position.
  assert.equal(fileNameAtOffset(arts, 'DEMO-BRAINSTORMING.md', 1), 'DEMO-BRAINSTORM.html');
  assert.equal(fileNameAtOffset(arts, 'DEMO-BRAINSTORMING.md', -1), 'DEMO-WIREFRAME-X.html');
});

test('delete resolves the pending artifact by the active path (FR-19)', () => {
  assert.ok(
    pageSrc.includes('artifacts.find((x) => x.fileName === modal.activePath)'),
    'delete finds the active artifact by path',
  );
  // onDeleted clamp semantics, in path terms.
  assert.equal(fileNameAfterDelete(arts, 'DEMO-WIREFRAME-X.html'), 'DEMO-BRAINSTORM.html');
});

test('close runs the deferred-unmount handler and the modal is driven by a data-state (Fix 3 exit animation)', () => {
  assert.ok(pageSrc.includes('onClose={handleModalClose}'), 'close is wired to the deferred-unmount handler');
  assert.ok(pageSrc.includes('dataState={modalClosing ? "closed" : "open"}'), 'data-state toggles between open and closed for the exit animation');
});

test('the markdown fetch effect resolves its path from the active path (FR-12, AD-8)', () => {
  assert.ok(
    pageSrc.includes('markdownPathForActive(modalDocs, modal.activePath)'),
    'effect reads markdown path from the unified modal doc list',
  );
  // And the helper returns the md path only for a markdown active doc.
  assert.equal(markdownPathForActive(arts, 'DEMO-BRAINSTORMING.md'), 'DEMO-BRAINSTORMING.md');
  assert.equal(markdownPathForActive(arts, 'DEMO-BRAINSTORM.html'), null);
});

test('the modal identity is the URL document and navigation drives the URL (URL source of truth)', () => {
  assert.ok(pageSrc.includes('useArtifactModal(getArtifacts, urlDoc, navigate)'),
    'modal is constructed from the URL document and a navigate fn');
  assert.ok(/path\.split\(['"]\/['"]\)\.map\(encodeURIComponent\)\.join\(['"]\/['"]\)/.test(pageSrc),
    'navigate encodes a possibly-nested doc path per-segment, not as one %2F-encoded segment');
  assert.ok(/const\s+urlDoc\s*=/.test(pageSrc),
    'page derives urlDoc from the slug');
});

test('in-modal navigation mutates the URL shallowly via the History API, not the Next router (smooth swap, no remount)', () => {
  // router.push/replace remounts the App Router page (it re-keys the [[...slug]] segment on a
  // param change), which reset isFullScreen and threw away the BufferedStage cross-fade — the
  // "full page reload" jank. The fix drives the URL with window.history.{push,replace}State so
  // the page only re-renders. Pin the mechanism so nobody reverts to router-based doc nav.
  assert.ok(/window\.history\.pushState\(/.test(pageSrc), 'navigate pushes via window.history.pushState');
  assert.ok(/window\.history\.replaceState\(/.test(pageSrc), 'navigate replaces via window.history.replaceState');
  assert.ok(/window\.history\.back\(\)/.test(pageSrc), 'navigate back uses window.history.back()');
  const navIdx = pageSrc.indexOf('const navigate = useCallback');
  const navBody = pageSrc.slice(navIdx, pageSrc.indexOf('}, [selectedProject])', navIdx));
  assert.ok(navIdx >= 0 && !/router\.(push|replace|back)\(/.test(navBody),
    'navigate must NOT call router.push/replace/back for in-modal doc switching (would remount the page)');
});

test('the route is read from usePathname and each segment is decoded exactly once (shallow-aware, no double-decode URIError)', () => {
  // usePathname() tracks shallow history.pushState (useParams does NOT) and returns the ENCODED
  // path, so each segment is decoded exactly once — the write side encodes once. A single guarded
  // decodeURIComponent round-trips names with spaces/'%' without throwing URIError (cf. PR #115).
  assert.ok(/const\s+pathname\s*=\s*usePathname\(\)/.test(pageSrc),
    'page derives the route from usePathname(), not useParams()');
  assert.ok(/pathname\.split\(['"]\/['"]\)\.filter\(Boolean\)/.test(pageSrc),
    'pathname is split into non-empty segments');
  assert.ok(/try\s*\{\s*return decodeURIComponent\([^)]*\)\s*;?\s*\}\s*catch/.test(pageSrc),
    'segments are decoded exactly once, guarded against malformed % (no URIError crash)');
  assert.ok(/const\s+urlProject\s*=/.test(pageSrc) && /const\s+urlDoc\s*=/.test(pageSrc),
    'urlProject and urlDoc are derived from the decoded segments');
});

test('urlDoc is reconstructed from every segment after docs/, not just the first (nested-path round-trip)', () => {
  assert.ok(/segs\.slice\(3\)/.test(pageSrc),
    'the parser takes everything after docs/ (segs.slice(3)), not a single fixed segment');
  assert.ok(!/segs\.length\s*>=\s*4\s*&&\s*segs\[2\]\s*===\s*'docs'\s*\?\s*decodeSeg\(segs\[3\]\)/.test(pageSrc),
    'the old segs[3]-only parser is gone');
});

test('a missing document shows a load-gated not-found state, never while still loading', () => {
  assert.ok(pageSrc.includes('filesLoaded && !modalDocs.some((d) => d.path === modal.activePath)'),
    'not-found state is gated on filesLoaded and a path-absence check');
  assert.ok(pageSrc.includes('Document not found'),
    'a client-rendered document-not-found notice is present');
});

test('the DAG timeline routes doc clicks to the modal opener, not the retired drawer', () => {
  // `<DAGTimeline` (the real mount) must be searched for AFTER `<PlanningSection`
  // — a bare indexOf would instead match the earlier `<DAGTimelineSkeleton`
  // branch, whose name has `<DAGTimeline` as a literal prefix.
  const planningIdx = pageSrc.indexOf('<PlanningSection');
  const idx = pageSrc.indexOf('<DAGTimeline', planningIdx);
  assert.ok(planningIdx >= 0 && idx >= 0, '<PlanningSection> and <DAGTimeline> must both be present');
  const mount = pageSrc.slice(idx, pageSrc.indexOf('afterPlanningSlot', idx));
  assert.ok(/onDocClick=\{openArtifactModal\}/.test(mount),
    'a DAG onDocClick(path) drives the same open-by-path opener the planning tiles use');
});

test('the DocumentDrawer and its hook are fully unwired from the page (drawer retired as a destination)', () => {
  assert.ok(!pageSrc.includes('<DocumentDrawer'), 'DocumentDrawer no longer renders on the page');
  assert.ok(!pageSrc.includes('useDocumentDrawer'), 'useDocumentDrawer is no longer invoked');
  assert.ok(!pageSrc.includes('orderedDocs'), 'the drawer-only orderedDocs plumbing is removed');
});

test('the same open-by-path opener and not-found guard serve both the DAG and the planning tiles (single funnel, no doc-source-specific branch)', () => {
  // Both entry points call the identical `openArtifactModal` identifier — the
  // page has no separate "DAG doc" vs "planning doc" open path, so a DAG path
  // that doesn't resolve (not-yet-authored file) falls through the one guard
  // above rather than a bespoke/missing handler for that surface.
  const planningIdx = pageSrc.indexOf('<PlanningSection');
  const dagIdx = pageSrc.indexOf('<DAGTimeline', planningIdx);
  const tileIdx = pageSrc.indexOf('openArtifactModal(artifacts[index].fileName)');
  assert.ok(planningIdx >= 0 && dagIdx >= 0 && tileIdx >= 0);
  assert.ok(/onDocClick=\{openArtifactModal\}/.test(pageSrc.slice(planningIdx, dagIdx)),
    'PlanningSection (DagStateCard) doc-click uses the same opener');
});
