/**
 * The amendment planning-document writer.
 *
 * It rebuilds the Master Plan, rewrites the phase plans the amendment touches,
 * appends the amendment to the Requirements doc's record, and emits a handoff
 * for every new task — returning all of it as staged `{ path, contents }` pairs
 * rather than performing the writes, so the caller commits the whole amendment
 * as one transaction.
 *
 * The project's central safety property lives here: content behind the frontier
 * is copied out of the Master Plan's raw text by line slice and never
 * round-trips through the parser and an emitter. `ParsedPhase.body` is trimmed
 * and, on a task-bearing phase, stops at the first task heading — a re-render
 * cannot reproduce the source, and a completed phase whose plan text drifted
 * would mean the review that already ran judged different words than the plan
 * now claims. `startLine` exists for this and only this.
 *
 * Line terminators are part of those bytes. The raw text is split on `\n` alone,
 * so a CRLF line carries its own `\r` through the slice and out the far side
 * untouched, and freshly rendered lines are terminated the way the rest of the
 * document terminates its own — an amendment never converts a file's line
 * endings.
 *
 * Nothing here decides anything: the numbering, the merged totals and the merged
 * repo list all arrive pre-computed on `AmendmentMergePlan`, and this module
 * executes them.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  buildPhaseFrontmatter,
  buildTaskFrontmatter,
  phaseFilename,
  renderDoc,
  renderPhaseBody,
  renderTaskBody,
  taskFilename,
  unionTaskRepos,
} from '../plan-emitters.js';
import type { ParsedMasterPlan, ParsedPhase, ParsedTask } from '../explode-master-plan.js';
import { parseYaml, stringifyYaml } from '../yaml.js';
import { phaseId, taskId } from './frontier.js';
import type { Frontier } from './frontier.js';
import type { AmendmentMergePlan } from './merge-check.js';
import { readAmendmentFrontmatter } from './parse.js';

// ── Public surface ───────────────────────────────────────────────────────────

export interface PlanMergeInput {
  projectDir: string;
  projectName: string;
  masterPlanPath: string;
  requirementsPath: string;
  /** The Master Plan's raw text, exactly as read. Frozen blocks are sliced out of THIS,
   *  never re-rendered from `existing`. */
  masterPlanRaw: string;
  existing: ParsedMasterPlan;
  amendment: ParsedMasterPlan;
  /** e.g. "MYAPP-AMENDMENT-01.md" — the record of why, linked from both documents. */
  amendmentDocFileName: string;
  /** The decision record from `merge-check.ts` — numbering, reopen cascade, merged totals
   *  and repos. This writer executes it; it does not recompute any part of it. */
  mergePlan: AmendmentMergePlan;
  /** Carried so the writer can refuse to destroy text the merge checker judged frozen. */
  frontier: Frontier;
  nowIso: string;
}

export interface StagedWrite {
  path: string;
  contents: string;
}

export interface StagedDelete {
  path: string;
  /** What is being removed, for the transaction's own error prose, e.g. "task handoff P02-T03". */
  what: string;
}

export interface PlanMergeResult {
  writes: StagedWrite[];
  deletes: StagedDelete[];
  /** The merged plan as the rebuilt Master Plan states it, so the state writer and the
   *  document writer agree on numbering without either re-deriving it. */
  merged: ParsedMasterPlan;
}

// ── Document landmarks ───────────────────────────────────────────────────────

const H2_RE = /^##\s/;
const EXECUTION_MAP_HEADING_RE = /^##\s+Execution Map\s*$/i;
const AMENDMENTS_HEADING_RE = /^##\s+Amendments\s*$/i;
const RATIONALE_HEADING_RE = /^##\s+Rationale\s*$/i;
const PHASE_ANCHOR_RE = /^##\s+P\d{2}:/;
const TASK_ANCHOR_RE = /^###\s+P\d{2}-T\d{2}:/;

// ── Internal build model ─────────────────────────────────────────────────────

/** A line terminator, as a document uses it. */
type Eol = '\r\n' | '\n';

/** The Master Plan as bytes: the lines a block is sliced from, and how they end. */
interface SourceText {
  /** Split on `\n` alone, so a CRLF line keeps its `\r` as its last character and a
   *  slice reproduces the source bytes exactly — even where terminators are mixed.
   *  Every join in this module is a bare `\n` for the same reason. */
  lines: string[];
  /** The convention the document's own lines follow, and so the one new lines take. */
  eol: Eol;
}

interface TaskBuild {
  task: ParsedTask;
  /** The block's lines in the rebuilt document — a raw slice, or freshly rendered. */
  lines: string[];
  origin: 'carried' | 'revised' | 'introduced';
  /** The amendment that marks this task as amendment-born: the reviser's index for an
   *  'introduced' task, the origin amendment's index for a 'revised' one (or null when
   *  the plan carried it before any amendment touched it). Unused for 'carried', which
   *  never emits a handoff. */
  amendmentIndex: number | null;
  /** Where a 'revised' task's handoff document already lives on disk, read off the
   *  pre-merge task so the rewrite lands on the file it already has — renaming a
   *  renumbered task's handoff is out of scope. Null for every other origin. */
  handoffFilename: string | null;
}

interface PhaseBuild {
  phase: ParsedPhase;
  /** Heading through to the first task heading (or the whole block when task-less). */
  briefLines: string[];
  isNew: boolean;
  /** True when the amendment restates this existing phase's brief. */
  restated: boolean;
  /** The amendment that marks this phase as amendment-born, or null for a phase
   *  the original plan carried. Set for a phase this merge introduces, and
   *  carried through for one an earlier amendment introduced and this merge
   *  restates — never re-derived from the index of the amendment being merged. */
  amendmentIndex: number | null;
  tasks: TaskBuild[];
}

// ── Entry point ──────────────────────────────────────────────────────────────

/**
 * Merge an amendment into a project's planning documents.
 *
 * Reads the Requirements doc from disk (the Master Plan's text arrives on
 * `masterPlanRaw`); every output is a staged write.
 */
export function mergeAmendmentIntoPlan(input: PlanMergeInput): PlanMergeResult {
  const source = readSourceText(input.masterPlanRaw);
  const builds = buildMergedPhases(input, source);
  const mergedPhases = builds.map(build => build.phase);

  const executionMapLines = renderExecutionMapLines(mergedPhases);
  const preamble = rebuildPreamble(
    input.existing.preamble,
    executionMapLines,
    input.mergePlan.amendmentIndex,
    input.amendmentDocFileName,
    source.eol,
  );
  const frontmatter = rebuildFrontmatter(input, mergedPhases);

  const masterPlanContents = assembleMasterPlan(frontmatter, preamble, builds, source.eol);
  const phaseDocs = phaseDocWrites(input, builds);

  const writes: StagedWrite[] = [
    { path: input.masterPlanPath, contents: masterPlanContents },
    { path: input.requirementsPath, contents: appendRequirementsRecord(input) },
    ...phaseDocs.writes,
    ...taskHandoffWrites(input, builds),
  ];

  return { writes, deletes: phaseDocs.deletes, merged: { phases: mergedPhases, frontmatter, preamble } };
}

// ── Merged phase assembly ────────────────────────────────────────────────────

/**
 * Place every existing and amendment-born block at the slot `mergePlan.numbering`
 * assigns it, and produce each one's lines — sliced raw when the block is carried
 * through, rendered when the amendment restates or introduces it.
 */
function buildMergedPhases(input: PlanMergeInput, raw: SourceText): PhaseBuild[] {
  const { existing, amendment, mergePlan } = input;
  const rawLines = raw.lines;
  const declared = readAmendmentFrontmatter(amendment.frontmatter);
  const newPhaseIds = new Set(declared.addsPhases);

  // A block is either an introduction or a restatement; `adds_phases` is the only
  // thing that tells the two apart when a new phase claims an id the plan already
  // holds, and it is the amendment's own declaration rather than a re-derivation.
  const newBlocks = amendment.phases
    .filter(block => newPhaseIds.has(block.id))
    .sort((a, b) => a.index - b.index);
  const restatements = new Map<string, ParsedPhase>();
  for (const block of amendment.phases) {
    if (!newPhaseIds.has(block.id)) restatements.set(block.id, block);
  }

  // A revised task's block carries the id it is restating, exactly like a restated
  // phase's block does — found the same way, one level down.
  const revisedTaskIds = new Set(declared.revisesTasks);
  const taskRestatements = new Map<string, ParsedTask>();
  for (const block of amendment.phases) {
    for (const taskBlock of block.tasks) {
      if (revisedTaskIds.has(taskBlock.id)) taskRestatements.set(taskBlock.id, taskBlock);
    }
  }

  if (newBlocks.length !== mergePlan.addsPhases.length) {
    throw internalError(
      `the merge plan adds ${mergePlan.addsPhases.length} phase(s) but the amendment carries ${newBlocks.length} new phase block(s)`,
    );
  }

  const slots: (PhaseBuild | undefined)[] = new Array(mergePlan.mergedTotals.phases);

  existing.phases.forEach((source, i) => {
    const finalId = mergePlan.numbering.phases.get(source.id);
    if (finalId === undefined) {
      // Absent from the numbering and not a drop the merge plan declared is a bug;
      // absent because it IS a declared drop is the expected shape of a removal.
      if (!mergePlan.dropsPhases.includes(source.id)) {
        throw internalError(`the merge plan's numbering carries no entry for phase ${source.id}`);
      }
      if (input.frontier.phaseBriefEditable.get(source.index) !== true) {
        throw internalError(
          `refusing to remove phase ${source.id}, which the frontier holds frozen`,
        );
      }
      return;
    }
    const blockEnd = existing.phases[i + 1]?.startLine ?? rawLines.length + 1;
    place(
      slots,
      slotOfPhaseId(finalId) - 1,
      `phase ${finalId}`,
      buildCarriedPhase({
        input,
        raw,
        source,
        blockEnd,
        restatement: restatements.get(source.id) ?? null,
        taskRestatements,
        finalIndex: slotOfPhaseId(finalId),
      }),
    );
  });

  // `addsPhases` is emitted in merged order and the amendment's new blocks splice in
  // ascending declared order, so the two lists pair off positionally.
  mergePlan.addsPhases.forEach((added, i) => {
    place(
      slots,
      slotOfPhaseId(added.id) - 1,
      `phase ${added.id}`,
      buildIntroducedPhase(input, newBlocks[i]!, slotOfPhaseId(added.id), raw.eol),
    );
  });

  return slots.map((build, i) => {
    if (build === undefined) throw internalError(`no block landed at merged phase ${phaseId(i + 1)}`);
    return build;
  });
}

/**
 * An existing phase, carried into the merged plan. Its brief is replaced only when
 * the amendment restates it; each of its tasks is carried through verbatim, rendered
 * fresh when the amendment revises it, or dropped when the amendment removes it — an
 * amendment can add, revise, and drop tasks, not only add them.
 */
function buildCarriedPhase(args: {
  input: PlanMergeInput;
  raw: SourceText;
  source: ParsedPhase;
  blockEnd: number;
  restatement: ParsedPhase | null;
  taskRestatements: Map<string, ParsedTask>;
  finalIndex: number;
}): PhaseBuild {
  const { input, raw, source, blockEnd, restatement, taskRestatements, finalIndex } = args;
  const rawLines = raw.lines;
  const finalId = phaseId(finalIndex);
  const firstTaskLine = source.tasks[0]?.startLine ?? blockEnd;

  // A block that carries only a heading exists to host a new task, not to restate
  // the brief — replacing it there would drop the phase's intent and exit criteria
  // in exchange for nothing.
  const revised = restatement !== null && restatement.body.trim().length > 0 ? restatement : null;

  let briefLines: string[];
  let finalTitle: string;
  let amendmentIndex: number | null = null;
  if (revised === null) {
    assertAnchor(rawLines, source.startLine, PHASE_ANCHOR_RE, `phase ${source.id}`);
    briefLines = rewriteAnchor(
      sliceBlock(rawLines, source.startLine, firstTaskLine),
      PHASE_ID_PREFIX_RE,
      finalId,
    );
    finalTitle = source.title;
  } else {
    if (input.frontier.phaseBriefEditable.get(source.index) !== true) {
      throw internalError(
        `refusing to rewrite the brief of phase ${source.id}, which the frontier holds frozen`,
      );
    }
    // The restatement's own title is raw and unmarked — read the origin amendment
    // off the phase's on-disk frontmatter, before this write overwrites it, so the
    // frontmatter key still names the amendment the phase originates from. Nothing
    // derives meaning from parsing a title's prose, so that index is never reapplied
    // into the title itself.
    amendmentIndex = readOriginAmendmentIndex(input, source);
    finalTitle = revised.title;
    briefLines = renderBriefLines(finalId, finalTitle, revised.body, raw.eol);
  }

  // A restated phase block's tasks are a mix of genuinely new ones and revision
  // blocks for tasks the phase already holds — only the former are additions here;
  // the latter are handled, and placed, from the carried-task loop below.
  const added = (restatement?.tasks ?? []).filter(task => !taskRestatements.has(task.id));
  const dropsTaskIds = new Set(input.mergePlan.dropsTasks);
  const droppedInPhase = source.tasks.filter(task => dropsTaskIds.has(task.id)).length;
  const tasks: (TaskBuild | undefined)[] = new Array(source.tasks.length - droppedInPhase + added.length);

  source.tasks.forEach((task, i) => {
    const finalTaskId = input.mergePlan.numbering.tasks.get(task.id);
    if (finalTaskId === undefined) {
      // Absent from the numbering and not a drop the merge plan declared is a bug;
      // absent because it IS a declared drop is the expected shape of a removal.
      if (!dropsTaskIds.has(task.id)) {
        throw internalError(`the merge plan's numbering carries no entry for task ${task.id}`);
      }
      if (input.frontier.taskEditable.get(task.id) !== true) {
        throw internalError(
          `refusing to remove task ${task.id}, which the frontier holds frozen`,
        );
      }
      return;
    }
    const slot = slotOfTaskId(finalTaskId);
    if (slot.phase !== finalIndex) {
      throw internalError(
        `the merge plan sends task ${task.id} to ${finalTaskId}, outside its phase's merged slot ${finalId}`,
      );
    }

    const revision = taskRestatements.get(task.id) ?? null;
    if (revision !== null) {
      if (input.frontier.taskEditable.get(task.id) !== true) {
        throw internalError(
          `refusing to rewrite task ${task.id}, which the frontier holds frozen`,
        );
      }
      // The revision's own title is raw and unmarked — read the origin amendment off
      // the task's on-disk frontmatter, before this write overwrites it, so the
      // frontmatter key still names the amendment the task originates from. Nothing
      // derives meaning from parsing a title's prose, so that index is never reapplied
      // into the title itself.
      const revisionAmendmentIndex = readOriginTaskAmendmentIndex(input, task);
      const revisedTitle = revision.title;
      place(tasks, slot.task - 1, `task ${finalTaskId}`, {
        task: { ...revision, id: finalTaskId, phaseIndex: finalIndex, taskIndex: slot.task, title: revisedTitle, startLine: 0 },
        lines: renderTaskLines(finalTaskId, revisedTitle, revision.body, raw.eol),
        origin: 'revised',
        amendmentIndex: revisionAmendmentIndex,
        handoffFilename: taskFilename(input.projectName, task),
      });
      return;
    }

    const taskEnd = source.tasks[i + 1]?.startLine ?? blockEnd;
    assertAnchor(rawLines, task.startLine, TASK_ANCHOR_RE, `task ${task.id}`);
    place(tasks, slot.task - 1, `task ${finalTaskId}`, {
      task: { ...task, id: finalTaskId, phaseIndex: finalIndex, taskIndex: slot.task, startLine: 0 },
      lines: rewriteAnchor(sliceBlock(rawLines, task.startLine, taskEnd), TASK_ID_PREFIX_RE, finalTaskId),
      origin: 'carried',
      amendmentIndex: null,
      handoffFilename: null,
    });
  });

  for (const block of added) {
    place(tasks, block.taskIndex - 1, `task ${taskId(finalIndex, block.taskIndex)}`,
      introducedTask(input, block, finalIndex, raw.eol));
  }

  const resolved = resolveTasks(tasks, finalId);
  return {
    phase: {
      id: finalId,
      index: finalIndex,
      title: finalTitle,
      body: revised?.body ?? source.body,
      tasks: resolved.map(entry => entry.task),
      startLine: 0,
    },
    briefLines,
    isNew: false,
    restated: restatement !== null,
    amendmentIndex,
    tasks: resolved,
  };
}

/** A phase the amendment introduces — every line of it is new, marker and all. */
function buildIntroducedPhase(
  input: PlanMergeInput,
  block: ParsedPhase,
  finalIndex: number,
  eol: Eol,
): PhaseBuild {
  const finalId = phaseId(finalIndex);
  const title = block.title;
  const tasks: (TaskBuild | undefined)[] = new Array(block.tasks.length);
  for (const taskBlock of block.tasks) {
    place(tasks, taskBlock.taskIndex - 1, `task ${taskId(finalIndex, taskBlock.taskIndex)}`,
      introducedTask(input, taskBlock, finalIndex, eol));
  }
  const resolved = resolveTasks(tasks, finalId);
  return {
    phase: {
      id: finalId,
      index: finalIndex,
      title,
      body: block.body,
      tasks: resolved.map(entry => entry.task),
      startLine: 0,
    },
    briefLines: renderBriefLines(finalId, title, block.body, eol),
    isNew: true,
    restated: false,
    amendmentIndex: input.mergePlan.amendmentIndex,
    tasks: resolved,
  };
}

function introducedTask(
  input: PlanMergeInput,
  block: ParsedTask,
  finalPhaseIndex: number,
  eol: Eol,
): TaskBuild {
  const finalTaskId = taskId(finalPhaseIndex, block.taskIndex);
  const title = block.title;
  return {
    task: {
      ...block,
      id: finalTaskId,
      phaseIndex: finalPhaseIndex,
      taskIndex: block.taskIndex,
      title,
      startLine: 0,
    },
    lines: renderTaskLines(finalTaskId, title, block.body, eol),
    origin: 'introduced',
    amendmentIndex: input.mergePlan.amendmentIndex,
    handoffFilename: null,
  };
}

function resolveTasks(tasks: (TaskBuild | undefined)[], phaseAnchor: string): TaskBuild[] {
  return tasks.map((entry, i) => {
    if (entry === undefined) {
      throw internalError(`no block landed at merged task ${phaseAnchor}-T${String(i + 1).padStart(2, '0')}`);
    }
    return entry;
  });
}

// ── Master Plan assembly ─────────────────────────────────────────────────────

/**
 * Join the frontmatter, the preamble and the phase blocks into the document, and
 * record where every anchor landed so `merged` describes the file that was built.
 *
 * Blocks are joined line-by-line rather than as strings so a carried block's
 * trailing blank line stays exactly the separator it was in the source. The join
 * is always a bare `\n`: a carried line brings its own terminator with it, and
 * every fresh line was terminated to match the document before it arrived here.
 */
function assembleMasterPlan(
  frontmatter: Record<string, unknown>,
  preamble: string,
  builds: PhaseBuild[],
  eol: Eol,
): string {
  const yamlText = stringifyYaml(frontmatter).trimEnd();
  // The body opens on the blank line after the closing `---`; the preamble's first
  // line is the one after that.
  const bodyOffset = yamlText.split('\n').length + 4;

  const bodyLines: string[] = preamble.length > 0 ? preamble.split('\n') : [];
  if (bodyLines.length > 0) bodyLines.push(...terminated([''], eol));

  for (const build of builds) {
    build.phase.startLine = bodyOffset + bodyLines.length;
    bodyLines.push(...build.briefLines);
    for (const entry of build.tasks) {
      entry.task.startLine = bodyOffset + bodyLines.length;
      bodyLines.push(...entry.lines);
    }
  }

  // `readSourceText` gives the source's empty tail the document's terminator, since
  // a block landing behind it turns it into the blank line that separates them. When
  // nothing lands behind it, it is the file's closing newline and carries nothing.
  if (bodyLines.at(-1) === TAIL_ONLY_TERMINATOR) bodyLines[bodyLines.length - 1] = '';

  const head = terminated(['---', ...yamlText.split('\n'), '---', ''], eol);
  return [...head, ...bodyLines].join('\n');
}

/**
 * `total_phases` / `total_tasks` are recomputed from the merged blocks, and
 * `repos:` becomes the merged repo list — the parser enforces equality between
 * that list and the union of task target repos in both directions, so a stale
 * value makes the next read of the whole file throw.
 */
function rebuildFrontmatter(input: PlanMergeInput, mergedPhases: ParsedPhase[]): Record<string, unknown> {
  const frontmatter: Record<string, unknown> = { ...input.existing.frontmatter };
  if (input.mergePlan.mergedRepos.length > 0 || 'repos' in frontmatter) {
    frontmatter['repos'] = [...input.mergePlan.mergedRepos];
  }
  frontmatter['total_phases'] = mergedPhases.length;
  frontmatter['total_tasks'] = mergedPhases.reduce((sum, phase) => sum + phase.tasks.length, 0);
  return frontmatter;
}

function renderBriefLines(anchor: string, title: string, body: string, eol: Eol): string[] {
  const lines = [`## ${anchor}: ${title}`, ''];
  const trimmed = body.trim();
  if (trimmed.length > 0) lines.push(...trimmed.split('\n'), '');
  return terminated(lines, eol);
}

function renderTaskLines(anchor: string, title: string, body: string, eol: Eol): string[] {
  const lines = [`### ${anchor}: ${title}`, ''];
  const trimmed = body.trim();
  if (trimmed.length > 0) lines.push(...trimmed.split('\n'), '');
  return terminated(lines, eol);
}

// ── Preamble ─────────────────────────────────────────────────────────────────

/**
 * The Execution Map is regenerated in full every time: it indexes the whole plan
 * and sits in the most-read part of the document, so a stale one describes a plan
 * that no longer exists. It stays in the preamble region, where every phase is a
 * bold label with a mini-table — a heading here would make the document
 * unparseable on the next read.
 */
function renderExecutionMapLines(phases: ParsedPhase[]): string[] {
  const lines = ['## Execution Map', ''];
  for (const phase of phases) {
    const repos = unionTaskRepos(phase);
    const label = [`**${phase.id} · ${phase.title}**`];
    if (repos.length > 0) label.push(`repos: ${repos.join(', ')}`);
    if (phase.tasks.length > 0) {
      label.push(`order: ${phase.tasks.map(taskLabel).join(' → ')}`);
    }
    lines.push(label.join(' · '), '');
    if (phase.tasks.length > 0) {
      lines.push('| Task | Repo | Complexity | Purpose |', '|---|---|---|---|');
      for (const task of phase.tasks) {
        const purpose = task.purpose.trim().length > 0 ? task.purpose.trim() : '—';
        lines.push(`| ${taskLabel(task)} | ${task.targetRepos.join(', ')} | ${task.complexity} | ${purpose} |`);
      }
      lines.push('');
    }
  }
  return lines;
}

function taskLabel(task: ParsedTask): string {
  return `T${String(task.taskIndex).padStart(2, '0')}`;
}

/**
 * Regenerate the Execution Map in place and record this amendment in the
 * preamble's amendments list. The plan states itself as it is now — nothing is
 * annotated as changed and no superseded text is kept; git and the amendment
 * documents carry the provenance.
 *
 * The parser hands the preamble back stripped of its terminators, so every line
 * here — carried, replaced or inserted — is (re)terminated to the document's own
 * convention.
 */
function rebuildPreamble(
  preamble: string,
  executionMapLines: string[],
  amendmentIndex: number,
  amendmentDocFileName: string,
  eol: Eol,
): string {
  // The parser's preamble opens with the blank line that separates the frontmatter
  // from the body; the document puts that separator back on its own.
  let lines = trimLeadingBlanks(preamble.length > 0 ? preamble.split('\n') : []);
  lines = replaceSection(lines, EXECUTION_MAP_HEADING_RE, executionMapLines);
  lines = recordAmendment(lines, amendmentIndex, amendmentDocFileName);
  return terminated(trimTrailingBlanks(lines), eol).join('\n');
}

/** Swap a `## Heading` section's lines for fresh ones, appending the section if absent. */
function replaceSection(lines: string[], heading: RegExp, replacement: string[]): string[] {
  const start = lines.findIndex(line => heading.test(line));
  if (start === -1) return appendSection(lines, replacement);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (H2_RE.test(lines[i]!)) {
      end = i;
      break;
    }
  }
  return [...lines.slice(0, start), ...replacement, ...lines.slice(end)];
}

function appendSection(lines: string[], section: string[]): string[] {
  const trimmed = trimTrailingBlanks(lines);
  return trimmed.length === 0 ? [...section] : [...trimmed, '', ...section];
}

function recordAmendment(lines: string[], amendmentIndex: number, fileName: string): string[] {
  const bullet = `- **Amendment ${amendmentIndex}** — [${fileName}](${fileName})`;
  const start = lines.findIndex(line => AMENDMENTS_HEADING_RE.test(line));
  if (start === -1) return appendSection(lines, ['## Amendments', '', bullet]);

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (H2_RE.test(lines[i]!)) {
      end = i;
      break;
    }
  }
  const section = lines.slice(start, end);
  if (section.some(line => line.includes(`(${fileName})`))) return lines;

  let insertAt = end;
  while (insertAt > start + 1 && (lines[insertAt - 1] ?? '').trim().length === 0) insertAt--;
  return [...lines.slice(0, insertAt), bullet, ...lines.slice(insertAt)];
}

// ── Requirements ─────────────────────────────────────────────────────────────

/**
 * Append one entry per amendment under an `## Amendments` section, created on the
 * first amendment and appended to after. The original requirements are never
 * edited — the record of what was promised up front stays honest, and because the
 * final reviewer's contract is this document, appending expands the audit scope on
 * its own.
 */
function appendRequirementsRecord(input: PlanMergeInput): string {
  let raw: string;
  try {
    raw = fs.readFileSync(input.requirementsPath, 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException | null)?.code === 'ENOENT') {
      throw new Error(
        `merge-plan: the Requirements doc at ${input.requirementsPath} is missing — an amendment's record has nowhere to land`,
      );
    }
    throw err;
  }

  // The original bytes are reused whole; only what is appended is rendered, and it
  // follows the convention the document already keeps.
  const eol = dominantEol(raw);
  const index = input.mergePlan.amendmentIndex;
  const entry = [`### Amendment ${index} — ${amendmentDate(input)}`, ''];
  const rationale = extractRationale(input.amendment.preamble);
  if (rationale.length > 0) entry.push(...rationale.split('\n'), '');
  const effect = renderAmendmentEffectLine(input.mergePlan);
  if (effect !== null) entry.push(effect, '');
  entry.push(`Source: [${input.amendmentDocFileName}](${input.amendmentDocFileName})`);

  const body = raw.endsWith('\n') ? raw : `${raw}${eol}`;
  const needsSection = raw.split(/\r?\n/).every(line => !AMENDMENTS_HEADING_RE.test(line));
  const section = needsSection ? `${eol}## Amendments${eol}` : '';
  return `${body}${section}${eol}${entry.join(eol)}${eol}`;
}

/** The amendment's own date, as its document declares it. */
function amendmentDate(input: PlanMergeInput): string {
  const created = input.amendment.frontmatter['created'];
  if (typeof created === 'string' && created.trim().length > 0) return created.trim();
  if (created instanceof Date) return created.toISOString().slice(0, 10);
  return input.nowIso.slice(0, 10);
}

/**
 * What this amendment changed about work already on the plan, so the record does
 * not read as pure growth once an amendment can also revise and drop. Revisions are
 * named at the merged id the plan now uses; drops at the pre-merge id the amendment
 * removed. Null — and so rendered as no line at all — when the amendment is purely
 * additive.
 */
function renderAmendmentEffectLine(mergePlan: AmendmentMergePlan): string | null {
  const parts: string[] = [];
  if (mergePlan.revisesTasks.length > 0) {
    parts.push(`Revises: ${mergePlan.revisesTasks.map(task => task.id).join(', ')}`);
  }
  const drops = [...mergePlan.dropsTasks, ...mergePlan.dropsPhases];
  if (drops.length > 0) {
    parts.push(`Drops: ${drops.join(', ')}`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** The operator's own words, taken from the amendment document's `## Rationale`. */
function extractRationale(preamble: string): string {
  const lines = preamble.split('\n');
  const start = lines.findIndex(line => RATIONALE_HEADING_RE.test(line));
  if (start === -1) return '';
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (H2_RE.test(lines[i]!)) {
      end = i;
      break;
    }
  }
  return lines.slice(start + 1, end).join('\n').trim();
}

// ── Downstream documents ─────────────────────────────────────────────────────

/**
 * A phase plan is read by humans and by the phase reviewer and does not feed the
 * pipeline once a phase is running, which is exactly why it drifts without a
 * command holding it. Every phase the amendment touches is rewritten from the
 * merged phase, so the task table, the frontmatter `tasks` list and the revised
 * intent all agree with the plan. The removal side is the mirror of that: a
 * dropped phase's own plan document and a dropped task's own handoff document are
 * both staged for deletion, built from the pre-merge object off `input.existing`
 * since the filename helpers embed the pre-merge index.
 */
function phaseDocWrites(input: PlanMergeInput, builds: PhaseBuild[]): { writes: StagedWrite[]; deletes: StagedDelete[] } {
  const writes: StagedWrite[] = [];
  for (const build of builds) {
    if (!build.isNew && !build.restated) continue;
    const frontmatter = buildPhaseFrontmatter({
      projectName: input.projectName,
      phase: build.phase,
      createdIso: input.nowIso,
    });
    writes.push({
      path: path.join(input.projectDir, 'phases', phaseFilename(input.projectName, build.phase)),
      contents: renderDoc(
        build.amendmentIndex !== null ? withMarkerKey(frontmatter, build.amendmentIndex) : frontmatter,
        renderPhaseBody(build.phase),
      ),
    });
  }

  const deletes: StagedDelete[] = [];
  const dropsPhaseIds = new Set(input.mergePlan.dropsPhases);
  const dropsTaskIds = new Set(input.mergePlan.dropsTasks);
  for (const phase of input.existing.phases) {
    if (dropsPhaseIds.has(phase.id)) {
      deletes.push({
        path: path.join(input.projectDir, 'phases', phaseFilename(input.projectName, phase)),
        what: `phase plan ${phase.id}`,
      });
    }
    for (const task of phase.tasks) {
      if (dropsTaskIds.has(task.id)) {
        deletes.push({
          path: path.join(input.projectDir, 'tasks', taskFilename(input.projectName, task)),
          what: `task handoff ${task.id}`,
        });
      }
    }
  }

  return { writes, deletes };
}

/**
 * A new or revised task gets a handoff; a carried one is never re-emitted, because
 * it may already carry runtime execution notes that exist nowhere else — exactly
 * why a revise is confined to a task the frontier still holds unstarted, where no
 * such notes exist yet to lose.
 */
function taskHandoffWrites(input: PlanMergeInput, builds: PhaseBuild[]): StagedWrite[] {
  const writes: StagedWrite[] = [];
  for (const build of builds) {
    for (const entry of build.tasks) {
      if (entry.origin === 'carried') continue;
      const frontmatter = buildTaskFrontmatter({
        projectName: input.projectName,
        task: entry.task,
        createdIso: input.nowIso,
      });
      const filename = entry.handoffFilename ?? taskFilename(input.projectName, entry.task);
      writes.push({
        path: path.join(input.projectDir, 'tasks', filename),
        contents: renderDoc(
          entry.amendmentIndex !== null ? withMarkerKey(frontmatter, entry.amendmentIndex) : frontmatter,
          renderTaskBody(entry.task),
        ),
      });
    }
  }
  return writes;
}

/**
 * The amendment marker's contract half. The shared builders keep producing
 * identical output for planned and amendment-born documents alike, so the key is
 * added after they return.
 */
function withMarkerKey(frontmatter: Record<string, unknown>, amendmentIndex: number): Record<string, unknown> {
  return { ...frontmatter, amendment: amendmentIndex };
}

/**
 * The origin amendment index a carried phase already carries, read off its own
 * on-disk phase-plan document's frontmatter — never off `source.title`'s prose
 * suffix. Frontmatter is the marker's contract; the title is prose that nothing
 * derives meaning from parsing. Absent file, absent frontmatter, or an absent
 * `amendment` key all mean the phase is not amendment-born.
 */
function readOriginAmendmentIndex(input: PlanMergeInput, source: ParsedPhase): number | null {
  return readAmendmentMarkerFromDisk(path.join(input.projectDir, 'phases', phaseFilename(input.projectName, source)));
}

/**
 * The origin amendment index a revised task already carries, read off its own
 * on-disk task-handoff frontmatter — never off the title's prose suffix. Absent
 * file, absent frontmatter, or an absent `amendment` key all mean the task is not
 * amendment-born, and its revised title carries no marker.
 */
function readOriginTaskAmendmentIndex(input: PlanMergeInput, source: ParsedTask): number | null {
  return readAmendmentMarkerFromDisk(path.join(input.projectDir, 'tasks', taskFilename(input.projectName, source)));
}

/** The `amendment:` frontmatter key of a planning document already on disk, or null
 *  when the file is absent, carries no frontmatter, or carries no such key. */
function readAmendmentMarkerFromDisk(docPath: string): number | null {
  let raw: string;
  try {
    raw = fs.readFileSync(docPath, 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException | null)?.code === 'ENOENT') return null;
    throw err;
  }
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);
  if (match === null) return null;
  const frontmatter = parseYaml<Record<string, unknown>>(match[1] ?? '');
  const value = frontmatter?.['amendment'];
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

// ── Raw-text slicing ─────────────────────────────────────────────────────────

// `ParsedPhase.startLine` and `ParsedTask.startLine` are FILE-ABSOLUTE 1-based,
// counting the frontmatter block. Against `SourceText.lines`, the block's first
// line is at index (startLine - 1); its last line is at (nextStartLine - 2), or
// the final index when nothing follows it. The parser counts lines on `\r?\n`
// and this module splits on `\n`, which agree on every line break either can see.
const PHASE_ID_PREFIX_RE = /^(##\s+)P\d{2}(?=:)/;
const TASK_ID_PREFIX_RE = /^(###\s+)P\d{2}-T\d{2}(?=:)/;

/** What a CRLF document's empty tail looks like once it has been terminated. */
const TAIL_ONLY_TERMINATOR = '\r';

/**
 * The convention a document terminates its own lines with. A mixed file still
 * carries each of its own lines through a slice unchanged; this decides only what
 * the lines rendered here are terminated with.
 */
function dominantEol(raw: string): Eol {
  const crlf = (raw.match(/\r\n/g) ?? []).length;
  const breaks = (raw.match(/\n/g) ?? []).length;
  return crlf * 2 > breaks ? '\r\n' : '\n';
}

/**
 * Read the document as the bytes it is: lines that keep their own terminator.
 *
 * The split leaves an empty element after the file's closing newline. It owns no
 * bytes of its own, and a block landing behind it makes it the blank line that
 * separates them — so it is terminated like anything else rendered here, and
 * `assembleMasterPlan` takes that back if it ends up closing the document.
 */
function readSourceText(raw: string): SourceText {
  const eol = dominantEol(raw);
  const lines = raw.split('\n');
  if (raw.endsWith('\n')) lines[lines.length - 1] = terminated([''], eol)[0]!;
  return { lines, eol };
}

/**
 * Terminate freshly rendered lines the way the document terminates its own. Lines
 * sliced out of the raw text already carry their terminator and never come here.
 */
function terminated(lines: string[], eol: Eol): string[] {
  return eol === '\r\n' ? lines.map(line => `${line}\r`) : lines;
}

function sliceBlock(rawLines: string[], startLine: number, endLineExclusive: number): string[] {
  return rawLines.slice(startLine - 1, endLineExclusive - 1);
}

/**
 * Write a carried block's heading at the id the merge plan assigns it, leaving
 * every other byte of the block alone. When the id is unchanged — which is what
 * the frontier guarantees for anything frozen — the block is returned untouched.
 */
function rewriteAnchor(lines: string[], anchorPrefix: RegExp, finalAnchor: string): string[] {
  const heading = lines[0] ?? '';
  const rewritten = heading.replace(anchorPrefix, `$1${finalAnchor}`);
  return rewritten === heading ? lines : [rewritten, ...lines.slice(1)];
}

/**
 * The whole safety property rests on `masterPlanRaw` being the very text
 * `existing` was parsed from. A mismatch would silently slice the wrong lines
 * into a frozen block, so it fails loudly instead.
 */
function assertAnchor(rawLines: string[], startLine: number, expected: RegExp, what: string): void {
  const line = rawLines[startLine - 1];
  if (line === undefined || !expected.test(line)) {
    throw internalError(
      `masterPlanRaw does not line up with the parsed plan — expected ${what} at line ${startLine}, found ${line === undefined ? 'end of file' : JSON.stringify(line)}`,
    );
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function slotOfPhaseId(id: string): number {
  const match = /^P(\d{2})$/.exec(id);
  if (match === null) throw internalError(`"${id}" is not a phase anchor`);
  return Number.parseInt(match[1]!, 10);
}

function slotOfTaskId(id: string): { phase: number; task: number } {
  const match = /^P(\d{2})-T(\d{2})$/.exec(id);
  if (match === null) throw internalError(`"${id}" is not a task anchor`);
  return { phase: Number.parseInt(match[1]!, 10), task: Number.parseInt(match[2]!, 10) };
}

function place<T>(slots: (T | undefined)[], index: number, what: string, value: T): void {
  if (index < 0 || index >= slots.length) {
    throw internalError(`${what} lands outside the merged plan's ${slots.length} slot(s)`);
  }
  if (slots[index] !== undefined) throw internalError(`two blocks claim ${what}`);
  slots[index] = value;
}

function trimLeadingBlanks(lines: string[]): string[] {
  let start = 0;
  while (start < lines.length && (lines[start] ?? '').trim().length === 0) start++;
  return lines.slice(start);
}

function trimTrailingBlanks(lines: string[]): string[] {
  let end = lines.length;
  while (end > 0 && (lines[end - 1] ?? '').trim().length === 0) end--;
  return lines.slice(0, end);
}

function internalError(detail: string): Error {
  return new Error(`merge-plan: ${detail}`);
}
