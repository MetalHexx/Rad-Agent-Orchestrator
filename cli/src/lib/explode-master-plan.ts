import * as fs from 'node:fs';
import * as path from 'node:path';
import { stringifyYaml, parseYaml } from './yaml.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ParsedTask {
  /** Compound id, e.g. "P01-T01". */
  id: string;
  /** 1-based phase index this task belongs to. */
  phaseIndex: number;
  /** 1-based task index within the phase. */
  taskIndex: number;
  /** Human-readable title (after the colon). */
  title: string;
  /** Routing signal parsed from the task body's "**Complexity:**" line; defaults to "standard". */
  complexity: 'simple' | 'standard' | 'complex';
  /** Lead one-line purpose, taken from the task body, used for the generated phase table. */
  purpose: string;
  /** Target repo names parsed from the task body's "**Target repo:**" line, deduped by first occurrence. */
  targetRepos: string[];
  /** Raw lines of the task body, preserved for downstream emission. */
  body: string;
  /** File-absolute 1-based line number of the task's "### P{NN}-T{MM}:" heading. */
  startLine: number;
}

export interface ParsedPhase {
  /** Phase id, e.g. "P01". */
  id: string;
  /** 1-based phase index. */
  index: number;
  /** Human-readable title (after the colon). */
  title: string;
  /** Pre-task phase body (description, execution order, etc). */
  body: string;
  /** Tasks nested under this phase. */
  tasks: ParsedTask[];
}

export interface ParsedMasterPlan {
  phases: ParsedPhase[];
  /** Original frontmatter, if any. */
  frontmatter: Record<string, unknown>;
  /** Everything in the body above the first phase heading (e.g. the Intro). */
  preamble: string;
}

export class ParseError extends Error {
  readonly line: number;
  readonly expected: string;
  readonly found: string;
  constructor(detail: { line: number; expected: string; found: string; message: string }) {
    super(detail.message);
    this.name = 'ParseError';
    this.line = detail.line;
    this.expected = detail.expected;
    this.found = detail.found;
  }
  toDetail(): { line: number; expected: string; found: string; message: string } {
    return {
      line: this.line,
      expected: this.expected,
      found: this.found,
      message: this.message,
    };
  }
}

export interface ExplodeResult {
  emittedPhaseFiles: string[];
  emittedTaskFiles: string[];
  /** Timestamped backup dir path, or null if no pre-existing phases/ or tasks/ contents were moved. */
  backupDir: string | null;
}

// ── Helper functions (ported from state-io.ts) ────────────────────────────────

function readDocument(
  docPath: string,
): { frontmatter: Record<string, unknown>; content: string } | null {
  let raw: string;
  try {
    raw = fs.readFileSync(docPath, 'utf-8');
  } catch (err: unknown) {
    if (isEnoent(err)) return null;
    throw err;
  }

  // Match standard YAML frontmatter: starts with ---, ends with \n---
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, content: raw };
  }

  const frontmatterText = match[1] ?? '';
  const content = match[2] ?? '';
  const parsed = parseYaml(frontmatterText);
  const frontmatter =
    parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  return {
    frontmatter,
    content,
  };
}

function isEnoent(err: unknown): boolean {
  return (
    err !== null &&
    typeof err === 'object' &&
    (err as { code?: unknown }).code === 'ENOENT'
  );
}

function readState(projectDir: string): PipelineState | null {
  const statePath = path.join(projectDir, 'state.json');
  try {
    const raw = fs.readFileSync(statePath, 'utf-8');
    return JSON.parse(raw) as PipelineState;
  } catch (err: unknown) {
    if (isEnoent(err)) return null;
    throw err;
  }
}

function writeState(projectDir: string, state: PipelineState): void {
  fs.mkdirSync(projectDir, { recursive: true });
  const statePath = path.join(projectDir, 'state.json');
  const tmpPath = path.join(projectDir, 'state.json.tmp');
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
    fs.renameSync(tmpPath, statePath);
  } catch (err) {
    fs.rmSync(tmpPath, { force: true });
    throw err;
  }
}

function validateFrontmatterPhaseCreated(frontmatter: Record<string, unknown>): null | { error: string; field: string } {
  const tasks = frontmatter.tasks;
  if (!Array.isArray(tasks)) {
    return { error: 'Invalid value: tasks must be an array', field: 'tasks' };
  }
  if ((tasks as unknown[]).length === 0) {
    return { error: 'Invalid value: tasks must be a non-empty array', field: 'tasks' };
  }
  return null;
}

// ── Minimal types for state.json support ──────────────────────────────────────

interface IterationEntry {
  index: number;
  status: string;
  nodes: Record<string, unknown>;
  corrective_tasks: unknown[];
  doc_path?: string | null;
  repos: { name: string; commit_hash: string | null }[];
  complexity?: 'simple' | 'standard' | 'complex';
}

interface ForEachTaskNodeState {
  kind: 'for_each_task';
  status: string;
  iterations: IterationEntry[];
}

interface ForEachPhaseNodeState {
  kind: 'for_each_phase';
  status: string;
  iterations: IterationEntry[];
}

interface PipelineState {
  project?: { project_type?: string; [k: string]: unknown };
  graph: {
    nodes: Record<string, unknown>;
  };
}

// ── Regexes (line-anchored; the parser iterates lines, not the whole text) ────

const PHASE_HEADING_RE = /^##\s+P(\d{2}):\s*(.+?)\s*$/;
const TASK_HEADING_RE = /^###\s+P(\d{2})-T(\d{2}):\s*(.+?)\s*$/;
// Used to distinguish "looks like a phase/task heading with a bad id" from
// genuinely unrelated headings. Only flag when the shape is clearly intended
// to be a phase/task heading: `## P` or `## Phase` / `### P`.
// Generic `## Introduction` or `## Execution Order` must NOT trip this.
const LOOKS_LIKE_PHASE_RE = /^##\s+(P\d|Phase\b)/i;
const LOOKS_LIKE_TASK_RE = /^###\s+P\d/;

/**
 * Compute the number of lines in the YAML frontmatter block at the top of `raw`,
 * including the opening `---` line, the YAML body, and the closing `---` line.
 * Returns 0 when `raw` has no frontmatter (i.e. does not start with `---\n`).
 *
 * This MUST track the exact shape `readDocument` strips (see state-io.ts), so that
 * `frontmatterOffset + body_line = file_line`.
 */
function computeFrontmatterOffset(raw: string): number {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return 0;
  // match[0] is the full frontmatter block including the trailing newline (if any)
  // after the closing `---`. Count lines consumed from column 1 through the END of
  // the closing `---` line. `readDocument` leaves the body starting on the line
  // immediately after that — hence we return the number of lines up to and
  // including the closing `---`.
  const block = match[0];
  // Strip a single trailing \r?\n (the one AFTER the closing `---`, which belongs
  // to the separator between frontmatter and body, not to a frontmatter line).
  const withoutTrailingNewline = block.replace(/\r?\n$/, '');
  return withoutTrailingNewline.split(/\r?\n/).length;
}

/**
 * Split a master plan text into frontmatter + preamble (= body before first phase) + parsed phases/tasks.
 *
 * Parse-only, no filesystem side effects. Throws ParseError on malformed input.
 *
 * ParseError `line` numbers are FILE-ABSOLUTE (1-based from the top of the raw
 * file on disk), not body-relative. Real Master Plans carry ~8-14 lines of YAML
 * frontmatter which `readDocument` strips before parsing; reporting a
 * body-relative line would mislead the recovery-loop guidance when the planner
 * is told to "fix line N". We compute the frontmatter line count from the raw
 * file and offset every thrown line number accordingly.
 */
export function parseMasterPlan(masterPlanPath: string): ParsedMasterPlan {
  // Read raw first so we can measure the frontmatter offset; ENOENT → same
  // missing-file ParseError that readDocument's null branch used to produce.
  let raw: string;
  try {
    raw = fs.readFileSync(masterPlanPath, 'utf-8');
  } catch (err: unknown) {
    const code = (err as { code?: string } | null)?.code;
    if (code === 'ENOENT') {
      throw new ParseError({
        line: 1,
        expected: 'Master Plan file at ' + masterPlanPath,
        found: 'missing file',
        message: `Master Plan file not found at ${masterPlanPath}`,
      });
    }
    throw err;
  }

  const frontmatterOffset = computeFrontmatterOffset(raw);

  const doc = readDocument(masterPlanPath);
  if (doc === null) {
    // Defensive — readFileSync above succeeded, so readDocument should only be
    // null if the file vanished mid-call. Treat as missing-file.
    throw new ParseError({
      line: 1,
      expected: 'Master Plan file at ' + masterPlanPath,
      found: 'missing file',
      message: `Master Plan file not found at ${masterPlanPath}`,
    });
  }

  const frontmatter = doc.frontmatter;
  const body = doc.content;
  // Body line numbers are 1-based (i + 1). File-absolute line = body line +
  // frontmatterOffset. All ParseError.line values are emitted file-absolute.
  const lines = body.split(/\r?\n/);

  const phases: ParsedPhase[] = [];
  let preambleLines: string[] = [];
  let currentPhase: ParsedPhase | null = null;
  let currentTask: ParsedTask | null = null;
  let currentBodyLines: string[] = [];

  const flushTask = () => {
    if (currentTask !== null) {
      currentTask.body = currentBodyLines.join('\n').trimEnd();
      currentTask.complexity = extractComplexity(currentTask.body);
      currentTask.purpose = extractLeadSentence(currentTask.body);
      currentTask.targetRepos = extractTargetRepos(currentTask.body);
      currentPhase!.tasks.push(currentTask);
      currentTask = null;
      currentBodyLines = [];
    }
  };

  const flushPhase = () => {
    flushTask();
    if (currentPhase !== null) {
      if (currentPhase.tasks.length === 0) {
        // currentBodyLines still hold the phase body up to end of phase.
        currentPhase.body = currentBodyLines.join('\n').trimEnd();
      }
      phases.push(currentPhase);
      currentPhase = null;
      currentBodyLines = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    // File-absolute 1-based line number. The body starts on the file line just
    // after the closing `---` of the frontmatter (when present), so we add
    // frontmatterOffset (= 0 for frontmatter-less files) to the body index.
    const lineNumber = i + 1 + frontmatterOffset;

    const phaseMatch = line.match(PHASE_HEADING_RE);
    if (phaseMatch) {
      const [, numStr, title] = phaseMatch;
      const phaseIndex = Number.parseInt(numStr!, 10);
      if (Number.isNaN(phaseIndex) || phaseIndex < 1) {
        throw new ParseError({
          line: lineNumber,
          expected: 'a two-digit positive phase number (e.g. "P01")',
          found: `P${numStr}`,
          message: `Invalid phase number at line ${lineNumber}: "${line}"`,
        });
      }
      if (currentPhase !== null) {
        // Close the current phase. flushPhase() is the single owner of body
        // capture — it handles both task-bearing and task-less phases correctly
        // using the still-populated currentBodyLines.
        flushPhase();
      } else {
        // First phase — the lines accumulated so far are the preamble.
        preambleLines = currentBodyLines;
        currentBodyLines = [];
      }
      currentPhase = {
        id: `P${numStr}`,
        index: phaseIndex,
        title: (title ?? '').trim(),
        body: '',
        tasks: [],
      };
      continue;
    }

    // Check for a "looks like a phase heading but invalid id" — e.g. `## Some Phase Without ID`
    if (LOOKS_LIKE_PHASE_RE.test(line) && !line.match(PHASE_HEADING_RE)) {
      throw new ParseError({
        line: lineNumber,
        expected: '"## P{NN}: {Title}" phase heading',
        found: line,
        message: `Malformed phase heading at line ${lineNumber}: expected "## P{NN}: {Title}", found "${line}"`,
      });
    }

    const taskMatch = line.match(TASK_HEADING_RE);
    if (taskMatch) {
      const [, phaseNumStr, taskNumStr, title] = taskMatch;
      const phaseIndex = Number.parseInt(phaseNumStr!, 10);
      const taskIndex = Number.parseInt(taskNumStr!, 10);

      if (currentPhase === null) {
        throw new ParseError({
          line: lineNumber,
          expected: 'a "## P{NN}:" phase heading before any "### P{NN}-T{MM}:" task heading',
          found: line,
          message: `Task heading at line ${lineNumber} appears before any phase heading: "${line}"`,
        });
      }
      if (phaseIndex !== currentPhase.index) {
        throw new ParseError({
          line: lineNumber,
          expected: `task under current phase P${String(currentPhase.index).padStart(2, '0')}`,
          found: `P${phaseNumStr}`,
          message: `Task phase id mismatch at line ${lineNumber}: task claims phase P${phaseNumStr} but the enclosing phase is ${currentPhase.id}`,
        });
      }

      // Flush any prior task and capture phase body if this is the first task.
      if (currentTask === null && currentPhase.tasks.length === 0) {
        currentPhase.body = currentBodyLines.join('\n').trimEnd();
        currentBodyLines = [];
      }
      flushTask();

      currentTask = {
        id: `P${phaseNumStr}-T${taskNumStr}`,
        phaseIndex,
        taskIndex,
        title: (title ?? '').trim(),
        complexity: 'standard',
        purpose: '',
        targetRepos: [],
        body: '',
        startLine: lineNumber,
      };
      continue;
    }

    // Task-heading-shaped line that failed the strict regex — e.g. `### P01-TX: Bad ID`
    if (LOOKS_LIKE_TASK_RE.test(line) && !line.match(TASK_HEADING_RE)) {
      throw new ParseError({
        line: lineNumber,
        expected: '"### P{NN}-T{MM}: {Title}" task heading',
        found: line,
        message: `Malformed task heading at line ${lineNumber}: expected "### P{NN}-T{MM}: {Title}", found "${line}"`,
      });
    }

    // Accumulate body line.
    currentBodyLines.push(line);
  }

  // End of file — flush whatever is open.
  flushPhase();

  // ── Enforce task repo shape ───────────────────────────────────────────────
  // Walk every parsed task and verify:
  //   FR-4: a "**Target repo:**" line is present
  //   FR-5: the line names at least one repo (not empty)
  //   FR-6: every named repo is within the sealed repos: [] in the frontmatter
  // Enforcement is only active when the Master Plan declares a sealed repos list.
  const sealRaw = Array.isArray(frontmatter.repos) ? (frontmatter.repos as unknown[]) : [];
  const seal = new Set(sealRaw.map(String));
  if (seal.size > 0) {
    for (const phase of phases) {
      for (const task of phase.tasks) {
        const hasLine = /\*\*Target repo:\*\*/.test(task.body);
        if (!hasLine) {
          throw new ParseError({
            line: task.startLine, expected: 'a "**Target repo:**" line on every task',
            found: `task ${task.id} with no Target repo line`,
            message: `Task ${task.id} is missing its "**Target repo:**" line`,
          });
        }
        if (task.targetRepos.length === 0) {
          throw new ParseError({
            line: task.startLine, expected: 'at least one repo name on the "**Target repo:**" line',
            found: `task ${task.id} with an empty Target repo line`,
            message: `Task ${task.id} has a present-but-empty "**Target repo:**" line`,
          });
        }
        for (const r of task.targetRepos) {
          if (!seal.has(r)) {
            throw new ParseError({
              line: task.startLine, expected: `each task repo to be within the sealed repos: [${[...seal].join(', ')}]`,
              found: `task ${task.id} names "${r}"`,
              message: `Task ${task.id} names repo "${r}" which is not in the Master Plan's sealed repos:`,
            });
          }
        }
      }
    }
  }

  if (phases.length === 0) {
    // Point at the first body line (= first file line after frontmatter). For
    // frontmatter-less files this is line 1; for files with frontmatter it's
    // the line where a phase heading would have naturally started.
    throw new ParseError({
      line: frontmatterOffset + 1,
      expected: 'at least one "## P{NN}:" phase heading',
      found: 'no phase headings',
      message: 'Master Plan contains no parseable phase headings',
    });
  }

  return {
    phases,
    frontmatter,
    preamble: preambleLines.join('\n').trimEnd(),
  };
}

function extractComplexity(body: string): 'simple' | 'standard' | 'complex' {
  const match = body.match(/\*\*Complexity:\*\*[ \t]*([^\n]*)/);
  const value = (match?.[1] ?? '').trim().toLowerCase();
  if (value === 'simple' || value === 'standard' || value === 'complex') {
    return value;
  }
  return 'standard';
}

function extractLeadSentence(body: string): string {
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0) continue;
    if (/^\*\*[^*]+:\*\*/.test(line)) continue; // a "**Field:**" line
    if (/^\s*[-*]\s/.test(raw)) continue;       // a bullet
    if (/^#/.test(line)) continue;              // a heading
    if (/^```/.test(line)) continue;            // a fenced-code fence
    return line;
  }
  return '';
}

function extractTargetRepos(body: string): string[] {
  const repos: string[] = [];
  const seen = new Set<string>();
  const lineMatch = body.match(/\*\*Target repo:\*\*[ \t]*([^\n]*)/);
  if (lineMatch) {
    const items = (lineMatch[1] ?? '').split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
    for (const item of items) {
      if (!seen.has(item)) { seen.add(item); repos.push(item); }
    }
  }
  return repos;
}

// ── Filename helpers ──────────────────────────────────────────────────────────

/**
 * Slugify a phase/task title into the filename suffix. Mirrors the existing
 * hand-authored convention (SCREAMING-KEBAB-CASE).
 */
function titleToFilenameSlug(title: string): string {
  const cleaned = title
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'UNTITLED';
}

function phaseFilename(projectName: string, phase: ParsedPhase): string {
  const idx = String(phase.index).padStart(2, '0');
  return `${projectName}-PHASE-${idx}-${titleToFilenameSlug(phase.title)}.md`;
}

function taskFilename(projectName: string, task: ParsedTask): string {
  const pidx = String(task.phaseIndex).padStart(2, '0');
  const tidx = String(task.taskIndex).padStart(2, '0');
  return `${projectName}-TASK-P${pidx}-T${tidx}-${titleToFilenameSlug(task.title)}.md`;
}

// ── Emission ──────────────────────────────────────────────────────────────────

function unionTaskRepos(phase: ParsedPhase): string[] {
  const repos: string[] = [];
  const seen = new Set<string>();
  for (const task of phase.tasks) {
    for (const r of task.targetRepos) {
      if (!seen.has(r)) { seen.add(r); repos.push(r); }
    }
  }
  return repos;
}

function buildPhaseFrontmatter(opts: {
  projectName: string;
  phase: ParsedPhase;
  createdIso: string;
}): Record<string, unknown> {
  return {
    project: opts.projectName,
    phase: opts.phase.index,
    title: opts.phase.title,
    status: 'active',
    tasks: opts.phase.tasks.map(t => ({ id: `T${String(t.taskIndex).padStart(2, '0')}`, title: t.title })),
    repos: unionTaskRepos(opts.phase),
    created: opts.createdIso,
    type: 'phase_plan',
  };
}

function buildTaskFrontmatter(opts: {
  projectName: string;
  task: ParsedTask;
  createdIso: string;
}): Record<string, unknown> {
  return {
    project: opts.projectName,
    phase: opts.task.phaseIndex,
    task: opts.task.taskIndex,
    title: opts.task.title,
    status: 'pending',
    complexity: opts.task.complexity,
    repos: opts.task.targetRepos,
    created: opts.createdIso,
    type: 'task_handoff',
  };
}

function renderDoc(frontmatter: Record<string, unknown>, body: string): string {
  const frontmatterYaml = stringifyYaml(frontmatter).trimEnd();
  return `---\n${frontmatterYaml}\n---\n\n${body.trimEnd()}\n`;
}

function renderPhaseBody(phase: ParsedPhase): string {
  const header = `# Phase ${phase.index}: ${phase.title}`;
  const sections: string[] = [header, ''];
  if (phase.body.trim().length > 0) {
    sections.push(phase.body.trim(), '');
  }
  sections.push('## Tasks', '');
  if (phase.tasks.length === 0) {
    sections.push('_(no tasks emitted by explosion script — phase has no task headings in the Master Plan)_');
  } else {
    sections.push('| Task | Repo | Complexity | Purpose |', '|---|---|---|---|');
    for (const t of phase.tasks) {
      const tidx = `T${String(t.taskIndex).padStart(2, '0')}`;
      const repoCell = t.targetRepos.join(', ');
      const purposeCell = t.purpose.trim().length > 0 ? t.purpose : '—';
      sections.push(`| ${tidx} | ${repoCell} | ${t.complexity} | ${purposeCell} |`);
    }
    const order = phase.tasks.map(t => `T${String(t.taskIndex).padStart(2, '0')}`).join(' → ');
    sections.push('', `**Order:** ${order}`);
  }
  return sections.join('\n');
}

function renderTaskBody(task: ParsedTask): string {
  const pidx = String(task.phaseIndex).padStart(2, '0');
  const tidx = String(task.taskIndex).padStart(2, '0');
  const header = `# P${pidx}-T${tidx}: ${task.title}`;
  const sections: string[] = [header, ''];
  if (task.body.trim().length > 0) {
    sections.push(task.body.trim());
  } else {
    sections.push('_(empty body in Master Plan)_');
  }
  sections.push('', '## Execution Notes', '', '_(none yet — appended at runtime)_');
  return sections.join('\n');
}

// ── Backup-on-rerun helper ────────────────────────────────────────────────────

function hasContents(dir: string): boolean {
  try {
    const entries = fs.readdirSync(dir);
    return entries.length > 0;
  } catch {
    return false;
  }
}

function moveContentsTo(srcDir: string, destDir: string): void {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir)) {
    const srcPath = path.join(srcDir, entry);
    const destPath = path.join(destDir, entry);
    // Try rename (atomic on same filesystem); fall back to cpSync + rmSync on cross-device errors.
    try {
      fs.renameSync(srcPath, destPath);
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code === 'EXDEV' || code === 'EPERM' || code === 'ENOTEMPTY') {
        fs.cpSync(srcPath, destPath, { recursive: true });
        fs.rmSync(srcPath, { recursive: true, force: true });
      } else {
        throw err;
      }
    }
  }
}

function makeBackupDir(projectDir: string, nowIso?: string): string {
  const iso = nowIso ?? new Date().toISOString();
  const stamp = iso.replace(/[:.]/g, '-');
  return path.join(projectDir, 'backups', stamp);
}

// ── Public API: explodeMasterPlan ─────────────────────────────────────────────

export interface ExplodeOptions {
  projectDir: string;
  masterPlanPath: string;
  projectName: string;
  /** Override for deterministic tests; defaults to `new Date().toISOString()`. */
  nowIso?: string;
}

export function explodeMasterPlan(opts: ExplodeOptions): ExplodeResult {
  const { projectDir, masterPlanPath, projectName } = opts;
  const nowIso = opts.nowIso ?? new Date().toISOString();

  // 1. Parse first — NO filesystem side effects yet. Propagate ParseError up.
  const parsed = parseMasterPlan(masterPlanPath);

  const phasesDir = path.join(projectDir, 'phases');
  const tasksDir = path.join(projectDir, 'tasks');

  // 2. Backup-on-rerun.
  let backupDir: string | null = null;
  const phasesHas = hasContents(phasesDir);
  const tasksHas = hasContents(tasksDir);
  if (phasesHas || tasksHas) {
    backupDir = makeBackupDir(projectDir, nowIso);
    if (phasesHas) moveContentsTo(phasesDir, path.join(backupDir, 'phases'));
    if (tasksHas) moveContentsTo(tasksDir, path.join(backupDir, 'tasks'));
  }

  // 3. Ensure target dirs exist (they may have been removed by the move).
  fs.mkdirSync(phasesDir, { recursive: true });
  fs.mkdirSync(tasksDir, { recursive: true });

  // 4. Emit fresh files.
  const emittedPhaseFiles: string[] = [];
  const emittedTaskFiles: string[] = [];

  for (const phase of parsed.phases) {
    const fname = phaseFilename(projectName, phase);
    const fpath = path.join(phasesDir, fname);
    const frontmatter = buildPhaseFrontmatter({ projectName, phase, createdIso: nowIso });

    // 5a. Validate the emitted frontmatter — script-produced docs go through the same validator.
    // `phase_plan_created` rule exists (validates tasks non-empty array). For phases with zero tasks
    // we skip validation since the rule would reject empty-tasks-arrays (legit shape here), BUT
    // phases with tasks must pass.
    if (phase.tasks.length > 0) {
      const err = validateFrontmatterPhaseCreated(frontmatter);
      if (err !== null) {
        throw new Error(
          `Explosion emitter produced invalid phase frontmatter for ${fname}: ${err.error} (field: ${err.field})`,
        );
      }
    }

    fs.writeFileSync(fpath, renderDoc(frontmatter, renderPhaseBody(phase)), 'utf-8');
    emittedPhaseFiles.push(fpath);

    for (const task of phase.tasks) {
      const tname = taskFilename(projectName, task);
      const tpath = path.join(tasksDir, tname);
      const tfront = buildTaskFrontmatter({ projectName, task, createdIso: nowIso });
      // No frontmatter validator rule exists for task handoffs — fields are built
      // locally from deterministic inputs by buildTaskFrontmatter.
      fs.writeFileSync(tpath, renderDoc(tfront, renderTaskBody(task)), 'utf-8');
      emittedTaskFiles.push(tpath);
    }
  }

  // 6. Seed state.json iterations if a state.json exists for the project.
  const state = readState(projectDir);
  if (state !== null) {
    const fmType = parsed.frontmatter['project-type'];
    const projectType = fmType === 'side-project' ? 'side-project' : 'standard';
    state.project = { ...(state.project ?? {}), project_type: projectType };
    seedIterations(state, parsed, projectName, emittedPhaseFiles, emittedTaskFiles, projectDir);
    writeState(projectDir, state);
  }

  return {
    emittedPhaseFiles,
    emittedTaskFiles,
    backupDir,
  };
}

function toRelativeDocPath(absPath: string, projectDir: string): string {
  const rel = path.relative(projectDir, absPath);
  // Normalize to forward slashes — matches the legacy state.json convention
  // (phases/NAME-PHASE-NN-TITLE.md, tasks/NAME-TASK-PNN-TMM-TITLE.md) and
  // keeps state.json portable across platforms + check-in/check-out.
  return rel.split(path.sep).join('/');
}

function seedIterations(
  state: PipelineState,
  parsed: ParsedMasterPlan,
  _projectName: string,
  emittedPhaseFiles: string[],
  emittedTaskFiles: string[],
  projectDir: string,
): void {
  // Locate phase_loop; if absent (partial template such as default.yml), create a minimal one.
  let phaseLoop = state.graph.nodes['phase_loop'] as ForEachPhaseNodeState | undefined;
  if (phaseLoop === undefined) {
    phaseLoop = {
      kind: 'for_each_phase',
      status: 'not_started',
      iterations: [],
    };
    state.graph.nodes['phase_loop'] = phaseLoop;
  } else if (phaseLoop.kind !== 'for_each_phase') {
    throw new Error(
      `explosion script: expected state.graph.nodes.phase_loop to be 'for_each_phase', got '${phaseLoop.kind}'`,
    );
  }

  // Wipe and re-seed. Reset phase_loop.status too — all iterations are
  // regenerated as not_started, so a stale in_progress/completed status on the
  // container would be inconsistent with the fresh children. The nested
  // task_loop statuses are set explicitly below.
  phaseLoop.iterations = [];
  phaseLoop.status = 'not_started';
  let taskFilePointer = 0;
  for (let i = 0; i < parsed.phases.length; i++) {
    const phase = parsed.phases[i]!;
    const phaseFileAbs = emittedPhaseFiles[i] ?? null;
    const phaseFile = phaseFileAbs !== null ? toRelativeDocPath(phaseFileAbs, projectDir) : null;

    const taskLoopIterations: IterationEntry[] = [];
    for (let j = 0; j < phase.tasks.length; j++) {
      const taskFileAbs = emittedTaskFiles[taskFilePointer++] ?? null;
      const taskFile = taskFileAbs !== null ? toRelativeDocPath(taskFileAbs, projectDir) : null;
      const task = phase.tasks[j]!;
      taskLoopIterations.push({
        index: j,
        status: 'not_started',
        nodes: {},
        corrective_tasks: [],
        doc_path: taskFile,
        repos: task.targetRepos.map(name => ({ name, commit_hash: null })),
        complexity: task.complexity,
      });
    }
    const taskLoop: ForEachTaskNodeState = {
      kind: 'for_each_task',
      status: 'not_started',
      iterations: taskLoopIterations,
    };

    const phaseEntry: IterationEntry = {
      index: i,
      status: 'not_started',
      nodes: { task_loop: taskLoop },
      corrective_tasks: [],
      doc_path: phaseFile,
      repos: unionTaskRepos(phase).map(name => ({ name, commit_hash: null })),
    };
    phaseLoop.iterations.push(phaseEntry);
  }
}
