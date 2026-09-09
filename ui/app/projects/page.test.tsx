/**
 * Tests for projects/page — module exports and dependency verification.
 * Run with: npx tsx --tsconfig ui/tsconfig.test.json ui/app/projects/page.test.tsx
 */
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import ProjectsPage from './[[...slug]]/page';

// ─── Source text helper ───────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const sourceText = readFileSync(join(__dirname, '[[...slug]]', 'page.tsx'), 'utf-8');

// ─── Test runner ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`  ✗ ${name}\n    ${msg}`);
    failed++;
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

async function run() {
  console.log('projects/page — exports and contracts');

  await test('Default export is a function named ProjectsPage', () => {
    assert.strictEqual(typeof ProjectsPage, 'function', 'Default export should be a function');
    assert.strictEqual(ProjectsPage.name, 'ProjectsPage', 'Default export should be named ProjectsPage');
  });

  await test('Source contains id="main-content" attribute', () => {
    assert.ok(
      sourceText.includes('id="main-content"') || sourceText.includes("id='main-content'"),
      'projects/page.tsx must contain id="main-content" on the wrapper div'
    );
  });

  await test('Source constrains page height to viewport minus header', () => {
    assert.ok(
      sourceText.includes('h-[calc(100vh-3.5rem)]'),
      'projects/page.tsx must size the outer wrapper to `h-[calc(100vh-3.5rem)]` so the viewport never overflows the sticky 56px header'
    );
  });

  // ─── Follow-mode integration (P04-T04) ────────────────────────────────────

  await test('Source imports useFollowMode from @/hooks/use-follow-mode', () => {
    assert.ok(
      /import\s*\{\s*useFollowMode\s*\}\s*from\s*["']@\/hooks\/use-follow-mode["']/.test(sourceText),
      'projects/page.tsx must import useFollowMode from @/hooks/use-follow-mode'
    );
  });

  await test('Source does NOT import TimelineToolbar from @/components/dag-timeline', () => {
    // Follow Mode is now controlled by the shadcn Switch inside <ProjectHeader>.
    // TimelineToolbar was deleted; the page must no longer import it.
    assert.ok(
      !sourceText.includes('TimelineToolbar'),
      'projects/page.tsx must not reference TimelineToolbar'
    );
  });

  await test('Source calls useFollowMode( at least once', () => {
    assert.ok(
      sourceText.includes('useFollowMode('),
      'projects/page.tsx must invoke useFollowMode('
    );
  });

  await test('Source does NOT render <TimelineToolbar', () => {
    assert.ok(
      !sourceText.includes('<TimelineToolbar'),
      'projects/page.tsx must not render <TimelineToolbar (Follow Mode is now inside ProjectHeader)'
    );
  });

  await test('Source threads followMode and toggleFollowMode into <ProjectHeader>', () => {
    assert.ok(
      sourceText.includes('followMode={followMode}'),
      'projects/page.tsx must pass followMode={followMode} to <ProjectHeader>'
    );
    assert.ok(
      sourceText.includes('onToggleFollowMode={toggleFollowMode}'),
      'projects/page.tsx must pass onToggleFollowMode={toggleFollowMode} to <ProjectHeader>'
    );
  });

  await test('Source does NOT contain stub literal expandedLoopIds={[]}', () => {
    assert.ok(
      !sourceText.includes('expandedLoopIds={[]}'),
      'projects/page.tsx must not contain the Phase 1 stub expandedLoopIds={[]}'
    );
  });

  await test('Source does NOT contain stub literal onAccordionChange={() => {}}', () => {
    assert.ok(
      !sourceText.includes('onAccordionChange={() => {}}'),
      'projects/page.tsx must not contain the Phase 1 stub onAccordionChange={() => {}}'
    );
  });

  await test('Source passes expandedLoopIds={expandedLoopIds} to DAGTimeline', () => {
    assert.ok(
      sourceText.includes('expandedLoopIds={expandedLoopIds}'),
      'projects/page.tsx must pass expandedLoopIds={expandedLoopIds} to DAGTimeline'
    );
  });

  await test('Source passes onAccordionChange={onAccordionChange} to DAGTimeline', () => {
    assert.ok(
      sourceText.includes('onAccordionChange={onAccordionChange}'),
      'projects/page.tsx must pass onAccordionChange={onAccordionChange} to DAGTimeline'
    );
  });

  await test('<DAGTimeline> is rendered directly after <ProjectHeader> (no toolbar sibling)', () => {
    const projectHeaderOpenIdx = sourceText.indexOf('<ProjectHeader');
    assert.ok(projectHeaderOpenIdx >= 0, '<ProjectHeader must appear in page.tsx');
    const headerSelfCloseIdx = sourceText.indexOf('/>', projectHeaderOpenIdx);
    assert.ok(headerSelfCloseIdx >= 0, 'ProjectHeader must have a self-close');

    const dagTimelineIdx = sourceText.indexOf('<DAGTimeline');
    assert.ok(dagTimelineIdx >= 0, '<DAGTimeline must be present');

    assert.ok(
      dagTimelineIdx > headerSelfCloseIdx,
      '<DAGTimeline must appear after <ProjectHeader ... />'
    );
    assert.ok(
      !sourceText.includes('<TimelineToolbar'),
      'No <TimelineToolbar sibling may appear between <ProjectHeader /> and <DAGTimeline'
    );
  });

  // ─── Status band foundation (P05-T01) ────────────────────────────────────

  await test('Source destructures sseStatus and reconnect from useProjects (single SSE source of truth)', () => {
    // Banner status must reflect the same EventSource that drives state updates.
    // useProjects exposes sseStatus/reconnect from its own useSSE instance, so
    // the banner and its Retry button act on the connection delivering events.
    const useProjectsCallIdx = sourceText.indexOf('useProjects(');
    assert.ok(useProjectsCallIdx >= 0, 'page.tsx must call useProjects(');
    assert.ok(
      /const\s*\{[^}]*\bsseStatus\b[^}]*\breconnect\b[^}]*\}\s*=\s*useProjects\([^)]*\)/.test(sourceText)
      || /const\s*\{[^}]*\breconnect\b[^}]*\bsseStatus\b[^}]*\}\s*=\s*useProjects\([^)]*\)/.test(sourceText),
      'page.tsx must destructure sseStatus and reconnect from useProjects()'
    );
  });

  await test('Source sources banner sseStatus/reconnect from useProjects, which rides the single shared multiplexed connection (architectural guard)', () => {
    // The provider now multiplexes one shared EventSource across every consumer,
    // and useProjects subscribes through it — so the status/reconnect it exposes
    // describe that one shared connection. The banner reads them from useProjects,
    // keeping a single source of truth without the page opening its own stream.
    assert.ok(
      /const\s*\{[^}]*\bsseStatus\b[^}]*\breconnect\b[^}]*\}\s*=\s*useProjects\([^)]*\)/.test(sourceText)
      || /const\s*\{[^}]*\breconnect\b[^}]*\bsseStatus\b[^}]*\}\s*=\s*useProjects\([^)]*\)/.test(sourceText),
      'page.tsx must source sseStatus and reconnect from useProjects(), which rides the one shared connection'
    );
    assert.ok(
      sourceText.includes('status={sseStatus}'),
      'the SSE banner must reflect the single shared connection via status={sseStatus}'
    );
  });

  await test('Halt-slot call site precedes SSE-slot call site (stack order lock)', () => {
    const haltSlotIdx = sourceText.indexOf('<HaltReasonBanner');
    const sseSlotIdx = sourceText.indexOf('<SSEStatusBanner');
    assert.ok(haltSlotIdx >= 0, 'HaltReasonBanner must appear in page.tsx');
    assert.ok(sseSlotIdx >= 0, 'SSEStatusBanner must appear in page.tsx');
    assert.ok(
      haltSlotIdx < sseSlotIdx,
      'Halt-slot call site must appear before SSE-slot call site in source text'
    );
  });

  await test('Status band <div> sits between <ProjectHeader and <div className="px-6 py-4">', () => {
    const headerIdx = sourceText.indexOf('<ProjectHeader');
    assert.ok(headerIdx >= 0, '<ProjectHeader must be present');
    const statusBandIdx = sourceText.indexOf('<div className="flex flex-col">', headerIdx);
    assert.ok(statusBandIdx > headerIdx, 'Status band must appear after <ProjectHeader');
    // Prefix match (no trailing `">`) so the wrapper may carry extra layout
    // classes (e.g. `flex flex-col gap-3`) without breaking this ordering check.
    const timelineWrapperIdx = sourceText.indexOf('<div className="px-6 py-4', statusBandIdx);
    assert.ok(timelineWrapperIdx > statusBandIdx, 'Timeline wrapper must appear after status band');
  });

  await test('No import from halt-reason-banner, sse-status-banner, or dag-timeline-skeleton', () => {
    assert.ok(
      !sourceText.includes('@/components/dag-timeline/halt-reason-banner'),
      'page.tsx must not import halt-reason-banner yet (belongs to T02)'
    );
    assert.ok(
      !sourceText.includes('@/components/badges/sse-status-banner'),
      'page.tsx must not import sse-status-banner yet (belongs to T03)'
    );
    assert.ok(
      !sourceText.includes('@/components/dag-timeline/dag-timeline-skeleton'),
      'page.tsx must not import dag-timeline-skeleton yet (belongs to T04)'
    );
  });

  await test('No new fetch URL literals or new EventSource constructions in page.tsx', () => {
    // The only fetch call allowed is the pre-existing /api/projects/.../files one.
    // We check there is no new EventSource construction.
    assert.ok(
      !sourceText.includes('new EventSource('),
      'page.tsx must not introduce new EventSource constructions'
    );
    // Verify the only fetch URL is the pre-existing /api/projects/ one
    const fetchMatches = sourceText.match(/fetch\(`[^`]*`\)/g) ?? [];
    const templateLiteralFetches = fetchMatches.filter(m => !m.includes('/api/projects/'));
    assert.strictEqual(
      templateLiteralFetches.length,
      0,
      `page.tsx must not introduce new fetch URL literals beyond the pre-existing /api/projects/ call. Found: ${templateLiteralFetches.join(', ')}`
    );
    // Also check for string literal fetches
    assert.ok(
      !sourceText.match(/fetch\(["'][^"']*["']\)/),
      'page.tsx must not introduce new string-literal fetch calls'
    );
  });

  await test('No new npm package imports in page.tsx', () => {
    // Extract all "from ..." import specifiers
    const importSpecifiers = Array.from(sourceText.matchAll(/from\s+["']([^"']+)["']/g)).map(m => m[1]);
    const knownImports = new Set([
      'react',
      'next/navigation',
      '@/hooks/use-projects',
      '@/hooks/use-document-drawer',
      '@/hooks/use-follow-mode',
      '@/hooks/use-project-view-mode',
      '@/hooks/use-sse-context',
      '@/hooks/use-config-editor',
      '@/hooks/use-config-click-context',
      '@/hooks/use-project-artifacts',
      '@/hooks/use-delete-project',
      '@/hooks/use-artifact-modal',
      '@/hooks/use-artifact-live',
      '@/hooks/use-approval-wizard',
      '@/hooks/use-session-journey',
      '@/components/ui/sidebar',
      '@/components/ui/alert',
      '@/components/sidebar',
      '@/components/layout',
      '@/components/documents',
      '@/components/config',
      '@/components/dag-timeline',
      '@/components/planning-section',
      '@/components/overview',
      '@/components/session-journey',
      '@/components/dag-timeline/source-control-helpers',
      '@/components/dag-timeline/source-control-bind',
      '@/components/repo-registry/use-registry-store',
      '@/components/badges',
      '@/components/dashboard',
      '@/components/artifacts',
      '@/lib/document-ordering',
      '@/lib/modal-doc-model',
      '@/lib/project-view',
      '@/lib/hold-floor',
      '@/types/state',
      '@/types/components',
      '@/types/events',
    ]);
    const unknownImports = importSpecifiers.filter(spec => !knownImports.has(spec));
    assert.strictEqual(
      unknownImports.length,
      0,
      `page.tsx contains unexpected import specifiers: ${unknownImports.join(', ')}`
    );
  });

  await test('aria-live does not appear on the status-band container', () => {
    const statusBandIdx = sourceText.indexOf('<div className="flex flex-col">');
    assert.ok(statusBandIdx >= 0, 'Status band must be present');
    // The band closing tag is the next </div> after the SSE slot
    const sseSlotIdx = sourceText.indexOf('<SSEStatusBanner', statusBandIdx);
    assert.ok(sseSlotIdx >= 0, 'SSEStatusBanner must appear in band');
    const bandCloseIdx = sourceText.indexOf('</div>', sseSlotIdx);
    const bandRegion = sourceText.slice(statusBandIdx, bandCloseIdx);
    assert.ok(
      !bandRegion.includes('aria-live'),
      'Status band container must not carry aria-live (live regions belong to banner components T02/T03)'
    );
  });

  await test('Source reads the project slug from usePathname and feeds it to useProjects (URL precedence)', () => {
    assert.ok(/import\s*\{[^}]*\busePathname\b[^}]*\}\s*from\s*["']next\/navigation["']/.test(sourceText),
      'page must import usePathname from next/navigation (it tracks shallow history.pushState; useParams does not)');
    assert.ok(sourceText.includes('useProjects(urlProject)'),
      'page must pass the URL-named project into useProjects so it wins over the localStorage restore');
    assert.ok(/const\s+urlProject\s*=/.test(sourceText),
      'page must derive urlProject from the slug');
  });

  await test('Source degrades an unknown project to a load-gated not-found notice', () => {
    assert.ok(sourceText.includes("router.replace('/projects')"),
      'unknown project must fall back to bare /projects');
    assert.ok(/notFoundName/.test(sourceText),
      'page must track a client-rendered not-found name');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error('Unexpected error:', e);
  process.exit(1);
});
