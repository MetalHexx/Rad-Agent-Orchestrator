import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(__dirname, 'page.tsx'), 'utf-8');

test('page imports RepoDetailPane from the repo-registry component (FR-17)', () => {
  assert.match(page, /import.*RepoDetailPane.*from.*repo-detail-pane/);
});

test('page renders RepoDetailPane in the repo-selection branch with store-derived repo, upsertRepo, removeRepo, and onDeselect (FR-17)', () => {
  // Must use RepoDetailPane in JSX
  assert.match(page, /<RepoDetailPane/);
  // Must pass upsertRepo prop
  assert.match(page, /upsertRepo=/);
  // Must pass removeRepo prop
  assert.match(page, /removeRepo=/);
  // Must pass onDeselect that clears selection
  assert.match(page, /onDeselect/);
  // Must guard the repo selection branch with selected.kind === 'repo'
  assert.match(page, /selected\.kind\s*===\s*['"]repo['"]/);
});

test('page pulls upsertRepo and removeRepo from the store hook (FR-17)', () => {
  // The destructuring of useRegistryStore must include upsertRepo and removeRepo
  assert.match(page, /upsertRepo/);
  assert.match(page, /removeRepo/);
});

// --- Corrective P07-PHASE-C1 assertions ---

test('page imports GroupDetailPane from the repo-registry component (FR-9)', () => {
  assert.match(page, /import.*GroupDetailPane.*from.*group-detail-pane/);
});

test('page renders GroupDetailPane in the group-selection branch, not the placeholder (FR-9, FR-20)', () => {
  // Must use GroupDetailPane in JSX
  assert.match(page, /<GroupDetailPane/);
  // Must guard with selected.kind === 'group'
  assert.match(page, /selected\.kind\s*===\s*['"]group['"]/);
  // Must NOT use the placeholder paragraph any more
  assert.doesNotMatch(page, /Group:\s*\$\{selected\.slug\}/);
});

test('page passes upsertGroup, removeGroup, and onDeselect to GroupDetailPane (FR-9, FR-20)', () => {
  assert.match(page, /upsertGroup=/);
  assert.match(page, /removeGroup=/);
});

test('page imports AddRepoDrawer from the repo-registry component (FR-10, FR-15)', () => {
  assert.match(page, /import.*AddRepoDrawer.*from.*add-repo-drawer/);
});

test('page mounts AddRepoDrawer driven by drawer === "add-repo" (FR-10, FR-15)', () => {
  assert.match(page, /<AddRepoDrawer/);
  assert.match(page, /drawer\s*===\s*['"]add-repo['"]/);
});

test('page imports AddGroupDrawer from the repo-registry component (FR-11, FR-16)', () => {
  assert.match(page, /import.*AddGroupDrawer.*from.*add-group-drawer/);
});

test('page mounts AddGroupDrawer driven by drawer === "add-group" (FR-11, FR-16)', () => {
  assert.match(page, /<AddGroupDrawer/);
  assert.match(page, /drawer\s*===\s*['"]add-group['"]/);
});

test('page imports useRegistryLive from the repo-registry component (FR-24, AD-7)', () => {
  assert.match(page, /import.*useRegistryLive.*from.*use-registry-live/);
});

test('page calls useRegistryLive with onRefetch and dirty (FR-24, FR-25, AD-7, NFR-4)', () => {
  assert.match(page, /useRegistryLive\s*\(/);
  // Must pass onRefetch
  assert.match(page, /onRefetch/);
  // Must pass dirty
  assert.match(page, /dirty/);
});

test('page pulls refetch, upsertGroup, and removeGroup from the store hook (FR-9, FR-24)', () => {
  assert.match(page, /refetch/);
  assert.match(page, /upsertGroup/);
  assert.match(page, /removeGroup/);
});

test('page tracks paneDirty state and passes onDirtyChange to detail panes (FR-25)', () => {
  assert.match(page, /paneDirty/);
  assert.match(page, /onDirtyChange/);
});

// --- Nav-away unsaved-changes guard assertions (FR-26) ---

test('page imports useNavGuard and UnsavedChangesDialog from the nav-guard module (FR-26)', () => {
  assert.match(page, /import\s*\{[^}]*useNavGuard[^}]*\}\s*from\s*['"][^'"]*use-nav-guard['"]/);
  assert.match(page, /import\s*\{[^}]*UnsavedChangesDialog[^}]*\}\s*from\s*['"][^'"]*use-nav-guard['"]/);
});

test('page wires up the nav guard via useNavGuard (FR-26)', () => {
  assert.match(page, /useNavGuard\s*\(\s*\)/);
});

test('all three nav-away handlers route through guard(paneDirty, ...) (FR-26)', () => {
  // handleSelect must guard the intent
  assert.match(page, /function handleSelect[\s\S]*?guard\(paneDirty/);
  // handleAddRepo must guard the intent
  assert.match(page, /function handleAddRepo[\s\S]*?guard\(paneDirty/);
  // handleAddGroup must guard the intent
  assert.match(page, /function handleAddGroup[\s\S]*?guard\(paneDirty/);
  // The clean nav-away handlers no longer call setSelected/setDrawer directly without guarding
  assert.match(page, /guard\(/);
});

test('page renders the UnsavedChangesDialog wired to the guard state (FR-26)', () => {
  assert.match(page, /<UnsavedChangesDialog/);
  assert.match(page, /open=\{open\}/);
  assert.match(page, /onConfirm=\{onConfirm\}/);
  assert.match(page, /onCancel=\{onCancel\}/);
});

// --- Initial-load failure surfaces an error state (PR #109 review cycle 2) ---

test('page consumes the store error and renders RegistryErrorState instead of the empty state on a failed initial load', () => {
  // error must be pulled from the store hook (no longer dropped during destructuring)
  assert.match(page, /const\s*\{[^}]*\berror\b[^}]*\}\s*=\s*useRegistryStore\(\)/);
  // RegistryErrorState must be imported and rendered
  assert.match(page, /import[\s\S]*RegistryErrorState[\s\S]*from.*registry-empty-states/);
  assert.match(page, /<RegistryErrorState/);
  // gated on error && isEmpty so a transient refetch failure doesn't nuke a populated view
  assert.match(page, /error\s*&&\s*isEmpty/);
  // retry is wired to the store's refetch
  assert.match(page, /onRetry=\{refetch\}/);
});

// --- Detail panes remount per selection so draft state never goes stale (stale-draft fix) ---

test('detail panes are keyed by selection so draft state resets on switch', () => {
  assert.match(page, /<RepoDetailPane[\s\S]*?key=\{`repo:\$\{repo\.slug\}`\}/);
  assert.match(page, /<GroupDetailPane[\s\S]*?key=\{`group:\$\{group\.slug\}`\}/);
});

// --- Layout fits the available width and matches the /projects spacing gold standard ---

test('main column opts into min-w-0 so the detail pane cannot overflow the page row (overflow fix)', () => {
  assert.match(page, /<main className="flex min-w-0 flex-1 flex-col">/);
});

test('detail wrapper drops the redundant p-6 so padding is a single layer (matches /projects)', () => {
  assert.match(page, /<div className="flex flex-1 flex-col">/);
  assert.doesNotMatch(page, /flex flex-1 flex-col p-6/);
});

// --- FR-13 nav-guard bypass fix: back/forward searchParams change routes through guard() ---

test('searchParams useEffect calls guard() with paneDirty and a setSelected intent when dirty (FR-13)', () => {
  // The effect must use guard() when paneDirty is true, not call setSelected directly.
  // Confirming the guard discards unsaved changes, so the callback both selects the
  // parsed target AND clears paneDirty (mirrors handleSelect) — otherwise a later
  // nav re-prompts spuriously even though the user already chose to discard.
  assert.match(page, /guard\(true,\s*\(\)\s*=>\s*\{[\s\S]*?setSelected\(parsed\)[\s\S]*?setPaneDirty\(false\)[\s\S]*?\}\)/);
});

test('searchParams useEffect compares parsed selection against current to avoid infinite loops (FR-13)', () => {
  // The effect must check whether the incoming selection matches the current one before acting.
  assert.match(page, /isSame/);
  // It must use the functional setSelected form to read current inside the effect.
  assert.match(page, /setSelected\(\s*\(current\)/);
});

test('page creates a cancelRestoreUrlRef to restore the URL when guard is cancelled (FR-13)', () => {
  assert.match(page, /cancelRestoreUrlRef/);
  // The ref must be populated before calling guard, using selectionToQuery(current).
  assert.match(page, /selectionToQuery\(current\)/);
});

test('page wraps onCancel to restore the URL via router.replace when a URL-driven guard is cancelled (FR-13)', () => {
  // The local onCancel must call guardOnCancel and then conditionally router.replace from the ref.
  assert.match(page, /guardOnCancel\(\)/);
  assert.match(page, /cancelRestoreUrlRef\.current/);
});
