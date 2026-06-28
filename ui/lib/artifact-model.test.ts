import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveArtifacts, PIPELINE_DOC_SUFFIXES } from './artifact-model';

const PROJECT = 'DEMO';

test('filters to root .md/.html only, excluding subfolders and state.json (FR-1)', () => {
  const files = ['DEMO-BRAINSTORMING.md', 'DEMO-BRAINSTORM.html', 'state.json', 'reports/X.md', 'sub/Y.html'];
  const arts = deriveArtifacts(PROJECT, files);
  const names = arts.map((a) => a.fileName);
  assert.deepEqual(names.sort(), ['DEMO-BRAINSTORM.html', 'DEMO-BRAINSTORMING.md'].sort());
});

test('orders markdown first, then html, alphabetical within each type (FR-2)', () => {
  const files = [
    'DEMO-WIREFRAME-DAG-VIEW.html',
    'DEMO-WIREFRAME-LAUNCH-SCREEN.html',
    'DEMO-BRAINSTORM.html',
    'DEMO-BRAINSTORMING.md',
  ];
  const arts = deriveArtifacts(PROJECT, files);
  assert.deepEqual(arts.map((a) => a.fileName), [
    'DEMO-BRAINSTORMING.md',
    'DEMO-BRAINSTORM.html',
    'DEMO-WIREFRAME-DAG-VIEW.html',
    'DEMO-WIREFRAME-LAUNCH-SCREEN.html',
  ]);
});

test('assigns locked labels and humanized wireframe titles (FR-3)', () => {
  const files = ['DEMO-BRAINSTORMING.md', 'DEMO-BRAINSTORM.html', 'DEMO-WIREFRAME-LAUNCH-SCREEN.html'];
  const arts = deriveArtifacts(PROJECT, files);
  const byName = Object.fromEntries(arts.map((a) => [a.fileName, a]));
  assert.equal(byName['DEMO-BRAINSTORMING.md'].label, 'Brainstorm');
  assert.equal(byName['DEMO-BRAINSTORMING.md'].kind, 'markdown');
  assert.equal(byName['DEMO-BRAINSTORM.html'].label, 'Brainstorm Visual');
  assert.equal(byName['DEMO-BRAINSTORM.html'].kind, 'visual');
  assert.equal(byName['DEMO-WIREFRAME-LAUNCH-SCREEN.html'].label, 'Wireframe');
  assert.equal(byName['DEMO-WIREFRAME-LAUNCH-SCREEN.html'].kind, 'wireframe');
  assert.equal(byName['DEMO-WIREFRAME-LAUNCH-SCREEN.html'].title, 'Launch Screen');
});

test('an empty listing yields an empty artifact list without throwing (NFR-3, FR-1)', () => {
  assert.deepEqual(deriveArtifacts(PROJECT, []), []);
});

test('surfaces ANY root *.html as a generic visual; excludes non-html and non-root (tolerance)', () => {
  const files = ['random.html', 'OTHER-PROJECT-BRAINSTORM.html', 'notes.txt', 'sub/x.html'];
  // Under tolerance, every root *.html surfaces as a generic 'html' artifact
  // (even those that are not the canonical brainstorm-visual or a wireframe).
  // Non-html files (notes.txt) and non-root html (sub/x.html) stay excluded.
  const arts = deriveArtifacts(PROJECT, files);
  const names = arts.map((a) => a.fileName).sort();
  assert.deepEqual(names, ['OTHER-PROJECT-BRAINSTORM.html', 'random.html']);
  assert.ok(arts.every((a) => a.kind === 'html'));
  assert.ok(!names.includes('notes.txt'));
  assert.ok(!names.includes('sub/x.html'));
});

test('surfaces non-canonical root *.html as generic visuals, alphabetical (tolerance)', () => {
  const arts = deriveArtifacts(
    'DEMO',
    ['DEMO-BRAINSTORM-VISUAL.html', 'DEMO-MOCKUP.html'],
  );
  assert.equal(arts.length, 2);
  const byName = Object.fromEntries(arts.map((a) => [a.fileName, a]));

  assert.equal(byName['DEMO-BRAINSTORM-VISUAL.html'].kind, 'html');
  assert.equal(byName['DEMO-BRAINSTORM-VISUAL.html'].label, 'Visual');
  assert.equal(byName['DEMO-BRAINSTORM-VISUAL.html'].title, 'Brainstorm Visual');
  assert.equal(byName['DEMO-BRAINSTORM-VISUAL.html'].isMarkdown, false);

  assert.equal(byName['DEMO-MOCKUP.html'].kind, 'html');
  assert.equal(byName['DEMO-MOCKUP.html'].label, 'Visual');
  assert.equal(byName['DEMO-MOCKUP.html'].title, 'Mockup');
  assert.equal(byName['DEMO-MOCKUP.html'].isMarkdown, false);
});

test('includes a generic root .md (e.g. ARCHITECTURE) as a markdown doc with humanized title', () => {
  const files = ['DEMO-ARCHITECTURE.md'];
  const arts = deriveArtifacts(PROJECT, files);
  assert.equal(arts.length, 1);
  const a = arts[0];
  assert.equal(a.fileName, 'DEMO-ARCHITECTURE.md');
  assert.equal(a.kind, 'markdown');
  assert.equal(a.isMarkdown, true);
  assert.equal(a.title, 'Architecture');
  assert.equal(a.label, 'Doc');
});

test('humanizes multi-word generic root .md titles (strips project prefix and .md)', () => {
  const arts = deriveArtifacts('LIVE-DOCS', ['LIVE-DOCS-ARCHITECTURE.md']);
  assert.equal(arts.length, 1);
  assert.equal(arts[0].fileName, 'LIVE-DOCS-ARCHITECTURE.md');
  assert.equal(arts[0].title, 'Architecture');
  assert.equal(arts[0].label, 'Doc');
  assert.equal(arts[0].kind, 'markdown');
  assert.equal(arts[0].isMarkdown, true);
});

test('surfaces REQUIREMENTS (no timeline) but still excludes master-plan/plan-audit/error-log via the denylist', () => {
  const files = [
    'DEMO-REQUIREMENTS.md',
    'DEMO-MASTER-PLAN.md',
    'DEMO-PLAN-AUDIT.md',
    'DEMO-ERROR-LOG.md',
  ];
  // hasTimeline defaults to false: REQUIREMENTS surfaces as its own doc; the
  // other three pipeline outputs stay hidden.
  const arts = deriveArtifacts(PROJECT, files);
  assert.deepEqual(arts.map((a) => a.fileName), ['DEMO-REQUIREMENTS.md']);
  assert.equal(arts[0].label, 'Requirements');
});

test('surfaces REQUIREMENTS with a locked "Requirements" label when there is no pipeline timeline', () => {
  const arts = deriveArtifacts(PROJECT, ['DEMO-REQUIREMENTS.md']);
  assert.equal(arts.length, 1);
  assert.equal(arts[0].fileName, 'DEMO-REQUIREMENTS.md');
  assert.equal(arts[0].label, 'Requirements');
  assert.equal(arts[0].kind, 'markdown');
  assert.equal(arts[0].isMarkdown, true);
  assert.equal(arts[0].title, null);
});

test('suppresses REQUIREMENTS from the list when a pipeline timeline exists (DAG renders it instead)', () => {
  const arts = deriveArtifacts(PROJECT, ['DEMO-REQUIREMENTS.md'], true);
  assert.deepEqual(arts, []);
});

test('keeps pipeline denylist excluded while still surfacing REQUIREMENTS + a generic root .md (no timeline)', () => {
  const files = ['DEMO-REQUIREMENTS.md', 'DEMO-MASTER-PLAN.md', 'DEMO-ARCHITECTURE.md'];
  const arts = deriveArtifacts(PROJECT, files);
  // markdown first, alphabetical: ARCHITECTURE before REQUIREMENTS; MASTER-PLAN stays hidden.
  assert.deepEqual(arts.map((a) => a.fileName), ['DEMO-ARCHITECTURE.md', 'DEMO-REQUIREMENTS.md']);
});

test('excludes subfolder docs (phases/tasks/reports) for both .md and .html', () => {
  const files = ['phases/PHASE-1.md', 'tasks/TASK-A.md', 'reports/REPORT-Z.md', 'tasks/X.html'];
  const arts = deriveArtifacts(PROJECT, files);
  assert.deepEqual(arts, []);
});

test('exposes PIPELINE_DOC_SUFFIXES as a named extensible constant', () => {
  assert.ok(Array.isArray(PIPELINE_DOC_SUFFIXES));
  assert.ok(PIPELINE_DOC_SUFFIXES.includes('-REQUIREMENTS.md'));
  assert.ok(PIPELINE_DOC_SUFFIXES.includes('-MASTER-PLAN.md'));
  assert.ok(PIPELINE_DOC_SUFFIXES.includes('-PLAN-AUDIT.md'));
  assert.ok(PIPELINE_DOC_SUFFIXES.includes('-ERROR-LOG.md'));
});

test('regression: brainstorm, wireframes and a generic DIAGRAM html surface with correct labels/order (markdown first, then html alphabetical)', () => {
  const files = [
    'DEMO-BRAINSTORMING.md',
    'DEMO-BRAINSTORM.html',
    'DEMO-WIREFRAME-LAUNCH-SCREEN.html',
    'DEMO-DIAGRAM-FLOW.html',
  ];
  const arts = deriveArtifacts(PROJECT, files);
  assert.deepEqual(arts.map((a) => a.fileName), [
    'DEMO-BRAINSTORMING.md',
    'DEMO-BRAINSTORM.html',
    'DEMO-DIAGRAM-FLOW.html',
    'DEMO-WIREFRAME-LAUNCH-SCREEN.html',
  ]);
  const byName = Object.fromEntries(arts.map((a) => [a.fileName, a]));
  assert.equal(byName['DEMO-BRAINSTORMING.md'].label, 'Brainstorm');
  assert.equal(byName['DEMO-BRAINSTORM.html'].label, 'Brainstorm Visual');
  assert.equal(byName['DEMO-WIREFRAME-LAUNCH-SCREEN.html'].label, 'Wireframe');
  assert.equal(byName['DEMO-DIAGRAM-FLOW.html'].label, 'Visual');
  assert.equal(byName['DEMO-DIAGRAM-FLOW.html'].kind, 'html');
});

test('orders markdown first, then html, alphabetical within each type — deterministic, never mtime-based', () => {
  const files = [
    'DEMO-ARCHITECTURE.md',
    'DEMO-DIAGRAM-FLOW.html',
    'DEMO-WIREFRAME-DAG.html',
    'DEMO-WIREFRAME-LAUNCH.html',
    'DEMO-BRAINSTORM.html',
    'DEMO-BRAINSTORMING.md',
  ];
  const arts = deriveArtifacts(PROJECT, files);
  assert.deepEqual(arts.map((a) => a.fileName), [
    'DEMO-ARCHITECTURE.md',
    'DEMO-BRAINSTORMING.md',
    'DEMO-BRAINSTORM.html',
    'DEMO-DIAGRAM-FLOW.html',
    'DEMO-WIREFRAME-DAG.html',
    'DEMO-WIREFRAME-LAUNCH.html',
  ]);
});

test('orders markdown first, then html, alphabetical within each type (stable; never mtime-based)', () => {
  const files = ['DEMO-ZEBRA.html', 'DEMO-ALPHA.md', 'DEMO-APPLE.html', 'DEMO-BETA.md'];
  const arts = deriveArtifacts('DEMO', files);
  assert.deepEqual(arts.map((a) => a.fileName), [
    'DEMO-ALPHA.md', 'DEMO-BETA.md', 'DEMO-APPLE.html', 'DEMO-ZEBRA.html',
  ]);
});
