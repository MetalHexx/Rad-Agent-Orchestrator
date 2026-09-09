/**
 * Tests for ProjectHeader component logic.
 * Run with: npx tsx ui/components/dag-timeline/project-header.test.ts
 */
import assert from "node:assert";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { ProjectHeaderProps } from './project-header';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const headerSource = readFileSync(join(__dirname, 'project-header.tsx'), 'utf-8');
const barrelSource = readFileSync(join(__dirname, 'index.ts'), 'utf-8');

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`  ✗ ${name}\n    ${msg}`);
    failed++;
  }
}

// ─── Simulation (mirrors project-header.tsx logic) ───────────────────────────

type SimulateProjectHeaderProps = Omit<ProjectHeaderProps, 'followMode' | 'onToggleFollowMode'> & {
  followMode?: boolean;
  onToggleFollowMode?: () => void;
};

type ProjectViewMode = 'overview' | 'pipeline';

interface FollowModeSwitchSim {
  id: "follow-mode-switch";
  checked: boolean;
  className: "cursor-pointer";
  onCheckedChange: (...args: unknown[]) => void;
}

function simulateProjectHeader(props: SimulateProjectHeaderProps) {
  const showRow2 = props.graphStatus === 'in_progress' && !!props.currentPhaseName;
  const followMode = props.followMode ?? false;
  const onToggleFollowMode = props.onToggleFollowMode ?? (() => {});
  // Mirrors the call-site `() => onToggleFollowMode()` adapter — any
  // boolean argument supplied by the shadcn Switch is intentionally
  // discarded (not forwarded to the props callback). We wrap in a named
  // function expression so the synthesized handler ignores whatever argument
  // the primitive passes in without triggering lint's unused-param rule.
  const onCheckedChangeAdapter: (...args: unknown[]) => void =
    function (this: unknown) {
      onToggleFollowMode();
    };
  const followModeSwitch: FollowModeSwitchSim = {
    id: "follow-mode-switch",
    checked: followMode,
    className: "cursor-pointer",
    onCheckedChange: onCheckedChangeAdapter,
  };
  // Mirrors the ToggleGroup's onValueChange guard in project-header.tsx: an
  // empty array (re-clicking the already-active item) is ignored — there is
  // no "neither" mode.
  const onViewModeChange = props.onViewModeChange ?? (() => {});
  const onToggleValueChange = (values: string[]) => {
    if (values.length > 0) onViewModeChange(values[0] as ProjectViewMode);
  };
  return {
    projectName: props.projectName,
    outerElement: "header",
    outerClass: "border-b border-border px-6 py-4",
    ariaLabel: `Project ${props.projectName}`,
    row1Class: "flex flex-wrap items-center gap-3",
    nameClass: "text-lg font-semibold",
    showTierBadge: !!props.state && props.stateLabel !== undefined,
    state: props.state,
    stateLabel: props.stateLabel,
    showGateModeBadge: props.gateMode !== undefined,
    gateMode: props.gateMode,
    showRow2,
    currentPhaseName: showRow2 ? props.currentPhaseName : null,
    showProgress: showRow2 && !!props.progress,
    progress: showRow2 ? props.progress : null,
    // The right-hand cluster now holds both Follow Mode and the view toggle;
    // ml-auto lives here (moved off the old Follow Mode-only wrapper) so the
    // whole cluster — not just Follow Mode — is pushed to the row's end.
    rightClusterClass: "ml-auto inline-flex items-center gap-2",
    followModeLabelText: "Follow Mode",
    followModeLabelHtmlFor: "follow-mode-switch",
    followModeSwitch,
    showFollowMode: props.viewMode === 'pipeline',
    showToggle: props.viewMode !== undefined,
    onToggleValueChange,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

console.log("\nProjectHeader logic tests\n");

test("renders the project name", () => {
  const result = simulateProjectHeader({ projectName: "MY-PROJECT" });
  assert.strictEqual(result.projectName, "MY-PROJECT");
});

test('renders project name with "text-lg font-semibold" class', () => {
  const result = simulateProjectHeader({ projectName: "Test" });
  assert.ok(result.nameClass.includes("text-lg"), 'should include "text-lg"');
  assert.ok(result.nameClass.includes("font-semibold"), 'should include "font-semibold"');
});

test('outer element is <header> with aria-label', () => {
  const result = simulateProjectHeader({ projectName: "MyProj" });
  assert.strictEqual(result.outerElement, "header");
  assert.strictEqual(result.ariaLabel, "Project MyProj");
});

test('outer class includes border-b', () => {
  const result = simulateProjectHeader({ projectName: "Test" });
  assert.ok(result.outerClass.includes("border-b"), 'should include "border-b"');
});

test('row 1 has flex flex-wrap items-center gap-3 (unified wrapping row)', () => {
  const result = simulateProjectHeader({ projectName: "Test" });
  assert.ok(result.row1Class.includes("flex"), 'row1 should include "flex"');
  assert.ok(result.row1Class.includes("flex-wrap"), 'row1 should include "flex-wrap"');
  assert.ok(result.row1Class.includes("items-center"), 'row1 should include "items-center"');
  assert.ok(result.row1Class.includes("gap-3"), 'row1 should include "gap-3"');
});

test('PipelineTierBadge renders when state is provided (planning)', () => {
  const result = simulateProjectHeader({
    projectName: "Test",
    state: "planning",
    stateLabel: "Planning",
  });
  assert.strictEqual(result.showTierBadge, true);
  assert.strictEqual(result.state, "planning");
  assert.strictEqual(result.stateLabel, "Planning");
});

test('PipelineTierBadge renders when state is provided (executing)', () => {
  const result = simulateProjectHeader({
    projectName: "Test",
    state: "executing",
    stateLabel: "Executing",
  });
  assert.strictEqual(result.showTierBadge, true);
  assert.strictEqual(result.state, "executing");
  assert.strictEqual(result.stateLabel, "Executing");
});

test('PipelineTierBadge does not render when state is omitted', () => {
  const result = simulateProjectHeader({ projectName: "Test" });
  assert.strictEqual(result.showTierBadge, false);
});

test('GateModeBadge renders when gateMode is provided (string)', () => {
  const result = simulateProjectHeader({ projectName: "Test", gateMode: "task" });
  assert.strictEqual(result.showGateModeBadge, true);
  assert.strictEqual(result.gateMode, "task");
});

test('GateModeBadge renders when gateMode is null (explicit null)', () => {
  const result = simulateProjectHeader({ projectName: "Test", gateMode: null });
  assert.strictEqual(result.showGateModeBadge, true);
  assert.strictEqual(result.gateMode, null);
});

test('GateModeBadge does not render when gateMode is undefined (v4 path)', () => {
  const result = simulateProjectHeader({ projectName: "Test" });
  assert.strictEqual(result.showGateModeBadge, false);
});

test('Row 2 renders when graphStatus === "in_progress" AND currentPhaseName is truthy', () => {
  const result = simulateProjectHeader({
    projectName: "Test",
    graphStatus: "in_progress", currentPhaseName: "Phase 1",
  });
  assert.strictEqual(result.showRow2, true);
  assert.strictEqual(result.currentPhaseName, "Phase 1");
});

test('Row 2 is hidden when graphStatus !== "in_progress"', () => {
  const result = simulateProjectHeader({
    projectName: "Test",
    graphStatus: "completed", currentPhaseName: "Phase 1",
  });
  assert.strictEqual(result.showRow2, false);
});

test('Row 2 is hidden when graphStatus is "not_started"', () => {
  const result = simulateProjectHeader({
    projectName: "Test",
    graphStatus: "not_started", currentPhaseName: "Phase 1",
  });
  assert.strictEqual(result.showRow2, false);
});

test('Row 2 is hidden when currentPhaseName is null', () => {
  const result = simulateProjectHeader({
    projectName: "Test",
    graphStatus: "in_progress", currentPhaseName: null,
  });
  assert.strictEqual(result.showRow2, false);
});

test('Row 2 is hidden when currentPhaseName is undefined', () => {
  const result = simulateProjectHeader({
    projectName: "Test",
    graphStatus: "in_progress",
  });
  assert.strictEqual(result.showRow2, false);
});

test('Progress text renders as "{completed} of {total} phases" when progress is provided with row 2 conditions', () => {
  const result = simulateProjectHeader({
    projectName: "Test",
    graphStatus: "in_progress", currentPhaseName: "Phase 2",
    progress: { completed: 3, total: 5 },
  });
  assert.strictEqual(result.showRow2, true);
  assert.strictEqual(result.showProgress, true);
  assert.deepStrictEqual(result.progress, { completed: 3, total: 5 });
});

test('Progress text is hidden when progress is null even if row 2 is visible', () => {
  const result = simulateProjectHeader({
    projectName: "Test",
    graphStatus: "in_progress", currentPhaseName: "Phase 1",
    progress: null,
  });
  assert.strictEqual(result.showRow2, true);
  assert.strictEqual(result.showProgress, false);
});

test('Progress text is hidden when progress is undefined', () => {
  const result = simulateProjectHeader({
    projectName: "Test",
    graphStatus: "in_progress", currentPhaseName: "Phase 1",
  });
  assert.strictEqual(result.showRow2, true);
  assert.strictEqual(result.showProgress, false);
});

test('header without state or gateMode renders only projectName — no tier badge, no gate badge, no row 2', () => {
  const result = simulateProjectHeader({ projectName: "LEGACY" });
  assert.strictEqual(result.showTierBadge, false);
  assert.strictEqual(result.showGateModeBadge, false);
  assert.strictEqual(result.showRow2, false);
  assert.strictEqual(result.projectName, "LEGACY");
});

// ─── Right-hand cluster (Follow Mode + view toggle) ──────────────────────────

test('Right-hand cluster uses ml-auto and inline-flex gap-2 classes', () => {
  const result = simulateProjectHeader({ projectName: "Test" });
  assert.ok(result.rightClusterClass.includes("ml-auto"), 'cluster should include "ml-auto"');
  assert.ok(result.rightClusterClass.includes("inline-flex"), 'cluster should include "inline-flex"');
  assert.ok(result.rightClusterClass.includes("gap-2"), 'cluster should include "gap-2"');
});

test('Toggle is absent when viewMode is undefined', () => {
  const result = simulateProjectHeader({ projectName: "Test" });
  assert.strictEqual(result.showToggle, false);
});

test('Toggle renders when viewMode is "overview"', () => {
  const result = simulateProjectHeader({ projectName: "Test", viewMode: "overview" });
  assert.strictEqual(result.showToggle, true);
});

test('Toggle renders when viewMode is "pipeline"', () => {
  const result = simulateProjectHeader({ projectName: "Test", viewMode: "pipeline" });
  assert.strictEqual(result.showToggle, true);
});

test('Follow Mode is hidden when viewMode is undefined', () => {
  const result = simulateProjectHeader({ projectName: "Test" });
  assert.strictEqual(result.showFollowMode, false);
});

test('Follow Mode is hidden when viewMode is "overview"', () => {
  const result = simulateProjectHeader({ projectName: "Test", viewMode: "overview" });
  assert.strictEqual(result.showFollowMode, false);
});

test('Follow Mode renders when viewMode is "pipeline"', () => {
  const result = simulateProjectHeader({ projectName: "Test", viewMode: "pipeline" });
  assert.strictEqual(result.showFollowMode, true);
});

test('onValueChange([]) does not call onViewModeChange (empty-array guard — re-clicking the active item)', () => {
  let calls = 0;
  const result = simulateProjectHeader({
    projectName: "Test",
    viewMode: "pipeline",
    onViewModeChange: () => { calls++; },
  });
  result.onToggleValueChange([]);
  assert.strictEqual(calls, 0, 'an empty value array must be ignored — there is no "neither" mode');
});

test('onValueChange(["pipeline"]) calls onViewModeChange with "pipeline"', () => {
  const received: string[] = [];
  const result = simulateProjectHeader({
    projectName: "Test",
    viewMode: "overview",
    onViewModeChange: (mode) => { received.push(mode); },
  });
  result.onToggleValueChange(["pipeline"]);
  assert.deepStrictEqual(received, ["pipeline"]);
});

// ─── Follow Mode Switch wiring ───────────────────────────────────────────────

test('Follow Mode label text is exactly "Follow Mode" when followMode is true', () => {
  const result = simulateProjectHeader({
    projectName: "Test",
    followMode: true,
    onToggleFollowMode: () => {},
  });
  assert.strictEqual(result.followModeLabelText, "Follow Mode");
});

test('Follow Mode label text is exactly "Follow Mode" when followMode is false', () => {
  const result = simulateProjectHeader({
    projectName: "Test",
    followMode: false,
    onToggleFollowMode: () => {},
  });
  assert.strictEqual(result.followModeLabelText, "Follow Mode");
});

test("Follow Mode label htmlFor matches the Switch id (\"follow-mode-switch\")", () => {
  const result = simulateProjectHeader({
    projectName: "Test",
    followMode: false,
    onToggleFollowMode: () => {},
  });
  assert.strictEqual(result.followModeLabelHtmlFor, "follow-mode-switch");
  assert.strictEqual(result.followModeSwitch.id, "follow-mode-switch");
  assert.strictEqual(result.followModeLabelHtmlFor, result.followModeSwitch.id);
});

test("Follow Mode Switch carries className \"cursor-pointer\"", () => {
  const result = simulateProjectHeader({
    projectName: "Test",
    followMode: false,
    onToggleFollowMode: () => {},
  });
  assert.strictEqual(result.followModeSwitch.className, "cursor-pointer");
});

test("Follow Mode Switch checked === true when followMode is true", () => {
  const result = simulateProjectHeader({
    projectName: "Test",
    followMode: true,
    onToggleFollowMode: () => {},
  });
  assert.strictEqual(result.followModeSwitch.checked, true);
});

test("Follow Mode Switch checked === false when followMode is false", () => {
  const result = simulateProjectHeader({
    projectName: "Test",
    followMode: false,
    onToggleFollowMode: () => {},
  });
  assert.strictEqual(result.followModeSwitch.checked, false);
});

test("Invoking onCheckedChange(true) calls onToggleFollowMode exactly once and does not forward the argument", () => {
  let calls = 0;
  const receivedArgs: unknown[][] = [];
  const handler = (...args: unknown[]) => {
    calls++;
    receivedArgs.push(args);
  };
  const result = simulateProjectHeader({
    projectName: "Test",
    followMode: false,
    onToggleFollowMode: handler as () => void,
  });
  result.followModeSwitch.onCheckedChange(true);
  assert.strictEqual(calls, 1, "onToggleFollowMode should be called exactly once");
  assert.strictEqual(
    receivedArgs[0].length,
    0,
    "onToggleFollowMode should receive no arguments (the `checked` value must be discarded)",
  );
});

test("Invoking onCheckedChange(false) calls onToggleFollowMode exactly once and does not forward the argument", () => {
  let calls = 0;
  const receivedArgs: unknown[][] = [];
  const handler = (...args: unknown[]) => {
    calls++;
    receivedArgs.push(args);
  };
  const result = simulateProjectHeader({
    projectName: "Test",
    followMode: true,
    onToggleFollowMode: handler as () => void,
  });
  result.followModeSwitch.onCheckedChange(false);
  assert.strictEqual(calls, 1, "onToggleFollowMode should be called exactly once");
  assert.strictEqual(
    receivedArgs[0].length,
    0,
    "onToggleFollowMode should receive no arguments (the `checked` value must be discarded)",
  );
});

// ─── Tooltip copy strings ────────────────────────────────────────────────────

test('schema-version pill is removed from source (no schemaVersionTooltip helper)', () => {
  assert.ok(
    !headerSource.includes('schemaVersionTooltip'),
    'schemaVersionTooltip helper should be removed from project-header.tsx',
  );
});

test('graph-status NodeStatusBadge is removed from source (no statusTooltip helper)', () => {
  assert.ok(
    !headerSource.includes('statusTooltip'),
    'statusTooltip helper should be removed from project-header.tsx',
  );
});

test('PipelineTierBadge is rendered in source', () => {
  assert.ok(
    headerSource.includes('<PipelineTierBadge'),
    'PipelineTierBadge JSX should be present in project-header.tsx',
  );
});

test('gateModeTooltip "task" copy appears verbatim in source', () => {
  assert.ok(
    headerSource.includes("Task gate: approval requested after each task."),
    'gateMode task tooltip string missing from project-header.tsx',
  );
});

test('gateModeTooltip "phase" copy appears verbatim in source', () => {
  assert.ok(
    headerSource.includes("Phase gate: approval requested after each phase."),
    'gateMode phase tooltip string missing from project-header.tsx',
  );
});

test('gateModeTooltip "autonomous" copy appears verbatim in source', () => {
  assert.ok(
    headerSource.includes("Autonomous: pipeline proceeds without manual approval."),
    'gateMode autonomous tooltip string missing from project-header.tsx',
  );
});

test('gateModeTooltip null (global default) copy appears verbatim in source', () => {
  assert.ok(
    headerSource.includes("Global default: project-wide gate mode applies (no per-pipeline override)."),
    'gateMode null tooltip string missing from project-header.tsx',
  );
});

test('followModeTooltip on=true copy appears verbatim in source', () => {
  assert.ok(
    headerSource.includes("Follow mode is on: the active iteration auto-expands and completed iterations collapse."),
    'follow-mode on tooltip string missing from project-header.tsx',
  );
});

test('followModeTooltip on=false copy appears verbatim in source', () => {
  assert.ok(
    headerSource.includes("Follow mode is off. Click to re-engage and apply smart defaults."),
    'follow-mode off tooltip string missing from project-header.tsx',
  );
});

test('portfolio kind-badge tooltip copy appears verbatim in source', () => {
  assert.ok(
    headerSource.includes(
      "Portfolio: holds the design documents for a long-running initiative. It never executes — its iterations are separate projects beside it, not inside it.",
    ),
    'portfolio tooltip string missing from project-header.tsx',
  );
});

test('badge selection branches on KIND_PRESENTATION[...].replacesStateBadge', () => {
  assert.ok(
    headerSource.includes('KIND_PRESENTATION'),
    'project-header.tsx should import and use KIND_PRESENTATION to select the header badge',
  );
  assert.ok(
    headerSource.includes('replacesStateBadge'),
    'the replacesStateBadge flag should gate whether the kind badge replaces the state badge',
  );
});

// ─── TooltipProvider single-scope ────────────────────────────────────────────

test('exactly one <TooltipProvider> opening tag exists in source', () => {
  const openMatches = headerSource.match(/<TooltipProvider>/g) ?? [];
  assert.strictEqual(
    openMatches.length,
    1,
    `expected exactly one <TooltipProvider> opening tag; found ${openMatches.length}`,
  );
});

test('exactly one </TooltipProvider> closing tag exists in source', () => {
  const closeMatches = headerSource.match(/<\/TooltipProvider>/g) ?? [];
  assert.strictEqual(
    closeMatches.length,
    1,
    `expected exactly one </TooltipProvider> closing tag; found ${closeMatches.length}`,
  );
});

test('no attribute-bearing <TooltipProvider ...> tag exists in source', () => {
  assert.ok(
    !/<TooltipProvider\s/.test(headerSource),
    'no <TooltipProvider> tag should carry attributes (provider scope is a singleton)',
  );
});

// ─── TooltipTrigger render-prop discipline ───────────────────────────────────

test('every <TooltipTrigger ...> opening tag uses the render={ prop shape', () => {
  const triggerRegex = /<TooltipTrigger([^>]*)>/g;
  const attrSlices: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = triggerRegex.exec(headerSource)) !== null) {
    attrSlices.push(m[1]);
  }
  assert.ok(
    attrSlices.length > 0,
    'expected at least one <TooltipTrigger> in project-header.tsx',
  );
  for (const attrSlice of attrSlices) {
    assert.ok(
      /^\s+render=\{/.test(attrSlice),
      `TooltipTrigger must use render prop; got: <TooltipTrigger${attrSlice}>`,
    );
  }
});

// ─── Barrel shrink ───────────────────────────────────────────────────────────

test('barrel (index.ts) does not contain "SourceControlRow"', () => {
  assert.strictEqual(
    barrelSource.includes("SourceControlRow"),
    false,
    'barrel must not contain SourceControlRow (as export or comment)',
  );
});

test('barrel (index.ts) does not contain "TimelineToolbar"', () => {
  assert.strictEqual(
    barrelSource.includes("TimelineToolbar"),
    false,
    'barrel must not contain TimelineToolbar (as export or comment)',
  );
});

// ─── Retired files absent ────────────────────────────────────────────────────

test('retired file "source-control-row.tsx" does not exist on disk', () => {
  assert.strictEqual(
    existsSync(join(__dirname, 'source-control-row.tsx')),
    false,
    'source-control-row.tsx must not exist',
  );
});

test('retired file "source-control-row.test.ts" does not exist on disk', () => {
  assert.strictEqual(
    existsSync(join(__dirname, 'source-control-row.test.ts')),
    false,
    'source-control-row.test.ts must not exist',
  );
});

test('retired file "timeline-toolbar.tsx" does not exist on disk', () => {
  assert.strictEqual(
    existsSync(join(__dirname, 'timeline-toolbar.tsx')),
    false,
    'timeline-toolbar.tsx must not exist',
  );
});

test('retired file "timeline-toolbar.test.ts" does not exist on disk', () => {
  assert.strictEqual(
    existsSync(join(__dirname, 'timeline-toolbar.test.ts')),
    false,
    'timeline-toolbar.test.ts must not exist',
  );
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);

