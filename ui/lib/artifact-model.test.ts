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

test('pins REQUIREMENTS first when a pipeline timeline exists, with the requirements category', () => {
  const arts = deriveArtifacts(PROJECT, ['DEMO-REQUIREMENTS.md'], true);
  assert.deepEqual(arts.map((a) => a.fileName), ['DEMO-REQUIREMENTS.md']);
  assert.equal(arts[0].label, 'Requirements');
  assert.equal(arts[0].pinned, true);
  assert.equal(arts[0].category, 'requirements');
});

test('timeline context: Requirements then Master Plan pin first (fixed order), Error Log/Plan Audit surface in the normal group, none of the four pipeline docs are missing', () => {
  const files = [
    'DEMO-REQUIREMENTS.md',
    'DEMO-MASTER-PLAN.md',
    'DEMO-ERROR-LOG.md',
    'DEMO-PLAN-AUDIT.md',
    'DEMO-WIREFRAME-LAUNCH-SCREEN.html',
    'DEMO-ARCHITECTURE.md',
  ];
  const arts = deriveArtifacts(PROJECT, files, true);
  assert.deepEqual(arts.map((a) => a.fileName), [
    'DEMO-REQUIREMENTS.md',
    'DEMO-MASTER-PLAN.md',
    'DEMO-ARCHITECTURE.md',
    'DEMO-ERROR-LOG.md',
    'DEMO-PLAN-AUDIT.md',
    'DEMO-WIREFRAME-LAUNCH-SCREEN.html',
  ]);

  const byName = Object.fromEntries(arts.map((a) => [a.fileName, a]));
  assert.equal(byName['DEMO-REQUIREMENTS.md'].pinned, true);
  assert.equal(byName['DEMO-REQUIREMENTS.md'].category, 'requirements');
  assert.equal(byName['DEMO-MASTER-PLAN.md'].pinned, true);
  assert.equal(byName['DEMO-MASTER-PLAN.md'].category, 'master-plan');
  assert.equal(byName['DEMO-MASTER-PLAN.md'].label, 'Master Plan');
  assert.equal(byName['DEMO-ERROR-LOG.md'].label, 'Error Log');
  assert.equal(byName['DEMO-ERROR-LOG.md'].category, 'error-log');
  assert.equal(byName['DEMO-ERROR-LOG.md'].pinned, undefined);
  assert.equal(byName['DEMO-PLAN-AUDIT.md'].label, 'Plan Audit');
  assert.equal(byName['DEMO-PLAN-AUDIT.md'].category, 'plan-audit');
});

test('timeline context: Master Plan still pins even when Requirements is absent', () => {
  const arts = deriveArtifacts(PROJECT, ['DEMO-MASTER-PLAN.md', 'DEMO-ERROR-LOG.md'], true);
  assert.deepEqual(arts.map((a) => a.fileName), ['DEMO-MASTER-PLAN.md', 'DEMO-ERROR-LOG.md']);
  assert.equal(arts[0].pinned, true);
});

test('regression: hasTimeline === false returns exactly what deriveArtifacts returned before the timeline-context surfacing existed', () => {
  const files = [
    'DEMO-REQUIREMENTS.md',
    'DEMO-MASTER-PLAN.md',
    'DEMO-ERROR-LOG.md',
    'DEMO-PLAN-AUDIT.md',
    'DEMO-BRAINSTORMING.md',
    'DEMO-BRAINSTORM.html',
    'DEMO-WIREFRAME-LAUNCH-SCREEN.html',
    'DEMO-ARCHITECTURE.md',
  ];
  const arts = deriveArtifacts(PROJECT, files, false);
  assert.deepEqual(arts, [
    { fileName: 'DEMO-ARCHITECTURE.md', kind: 'markdown', label: 'Doc', title: 'Architecture', isMarkdown: true },
    { fileName: 'DEMO-BRAINSTORMING.md', kind: 'markdown', label: 'Brainstorm', title: null, isMarkdown: true },
    { fileName: 'DEMO-REQUIREMENTS.md', kind: 'markdown', label: 'Requirements', title: null, isMarkdown: true },
    { fileName: 'DEMO-BRAINSTORM.html', kind: 'visual', label: 'Brainstorm Visual', title: null, isMarkdown: false },
    { fileName: 'DEMO-WIREFRAME-LAUNCH-SCREEN.html', kind: 'wireframe', label: 'Wireframe', title: 'Launch Screen', isMarkdown: false },
  ]);
  // Master Plan / Plan Audit / Error Log stay hidden via the denylist, unchanged.
  assert.ok(!arts.some((a) => a.fileName === 'DEMO-MASTER-PLAN.md'));
  assert.ok(!arts.some((a) => a.fileName === 'DEMO-ERROR-LOG.md'));
  assert.ok(!arts.some((a) => a.fileName === 'DEMO-PLAN-AUDIT.md'));
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

test('recognizes an amendment doc by its ${project}-AMENDMENT- prefix (PIPELINE_DOC_SUFFIXES cannot match an indexed name)', () => {
  const arts = deriveArtifacts(PROJECT, ['DEMO-AMENDMENT-01.md']);
  assert.equal(arts.length, 1);
  assert.equal(arts[0].fileName, 'DEMO-AMENDMENT-01.md');
  assert.equal(arts[0].kind, 'markdown');
  assert.equal(arts[0].isMarkdown, true);
  assert.equal(arts[0].label, 'Amendment 1');
  assert.equal(arts[0].category, 'amendment');
});

test('recognizes amendment docs independent of hasTimeline', () => {
  const arts = deriveArtifacts(PROJECT, ['DEMO-AMENDMENT-01.md'], true);
  assert.equal(arts[0].label, 'Amendment 1');
  assert.equal(arts[0].category, 'amendment');
});

test('matches the project name literally, so a regex metacharacter in it cannot widen the amendment match', () => {
  const dotted = 'DEMO.V2';
  const arts = deriveArtifacts(dotted, ['DEMOXV2-AMENDMENT-01.md', 'DEMO.V2-AMENDMENT-01.md']);
  const byName = Object.fromEntries(arts.map((a) => [a.fileName, a]));
  assert.equal(byName['DEMO.V2-AMENDMENT-01.md'].category, 'amendment');
  assert.equal(byName['DEMO.V2-AMENDMENT-01.md'].label, 'Amendment 1');
  assert.notEqual(byName['DEMOXV2-AMENDMENT-01.md'].category, 'amendment');
});

test('matches the project name literally, so a regex metacharacter in it cannot widen the wireframe match', () => {
  const dotted = 'DEMO.V2';
  const arts = deriveArtifacts(dotted, ['DEMOXV2-WIREFRAME-LAUNCH.html', 'DEMO.V2-WIREFRAME-LAUNCH.html']);
  const byName = Object.fromEntries(arts.map((a) => [a.fileName, a]));
  assert.equal(byName['DEMO.V2-WIREFRAME-LAUNCH.html'].kind, 'wireframe');
  assert.equal(byName['DEMO.V2-WIREFRAME-LAUNCH.html'].title, 'Launch');
  assert.notEqual(byName['DEMOXV2-WIREFRAME-LAUNCH.html'].kind, 'wireframe');
});

test('a second amendment doc surfaces as its own row, distinct from the first', () => {
  const arts = deriveArtifacts(PROJECT, ['DEMO-AMENDMENT-01.md', 'DEMO-AMENDMENT-02.md']);
  assert.deepEqual(arts.map((a) => a.fileName), ['DEMO-AMENDMENT-01.md', 'DEMO-AMENDMENT-02.md']);
  const byName = Object.fromEntries(arts.map((a) => [a.fileName, a]));
  assert.equal(byName['DEMO-AMENDMENT-01.md'].label, 'Amendment 1');
  assert.equal(byName['DEMO-AMENDMENT-02.md'].label, 'Amendment 2');
  assert.ok(arts.every((a) => a.category === 'amendment'));
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
