// graph-service/src/capabilities/explosion-runner.ts
//
// The real host-side fulfillment of `rad-orc:explosion`'s `MASTER_PLAN_PARSER_CAPABILITY` slot:
// `docRead` the authored master-plan doc, run `parseMasterPlan`, `docWrite` the emitted per-phase
// and per-task docs, and hand back the `parsed`/`parse_failed` outcome the node type's own
// `handle` routes on (`explosion.ts` is never modified — its routing is reused as-is). Unlike
// `driver/resolvers.ts`'s `resolveExplosion` (a fake-ports test driver that never emits real
// docs), this is the doc-writing half a later phase wires into the real driver.
import type { Envelope, EventToken, NodeId } from '@rad-orchestration/graph-engine';
import type {
  DecorationCadence,
  ExplosionParseFailureData,
  ExplosionParseSuccessData,
  ParsedMasterPlan,
  ParsedPhase,
  ParsedTask,
} from '@rad-orchestration/graph-node-types';
import { EXPLOSION_PARSED_TOKEN, EXPLOSION_PARSE_FAILED_TOKEN, parseMasterPlan } from '@rad-orchestration/graph-node-types';
import type { CapabilityPorts } from './ports.js';

/** The two doc-read/doc-write ports this runner needs — never the other four. */
export type ExplosionRunnerPorts = Pick<CapabilityPorts, 'docRead' | 'docWrite'>;

export interface ExplosionRunnerInput {
  /** The node this run's `docWrite`/backup calls are attributed to (`IdempotentCallContext.originatingNodeId`) — the `rad-orc:explosion` node itself. */
  readonly explosionNodeId: NodeId;
  /** Where `handle` expects to find the sibling `rad-orc:master_plan` node's authored doc — read off that node's own `data.docPath` by the caller (this runner never touches the store). */
  readonly masterPlanDocPath: string;
  readonly masterPlanNodeId: NodeId;
  readonly planApprovalNodeId: NodeId;
  readonly cadence: DecorationCadence;
  /** The retry count *before* this attempt — carried straight through on a `parse_failed` outcome; `handle` is the one that increments it. */
  readonly parseRetryCount: number;
  /** Injectable clock for deterministic backup-stamp tests; defaults to a real `Date().toISOString()`. */
  readonly _now?: () => string;
}

/** Structurally identical to `driver/outcome.ts`'s `DriverOutcome` — defined locally so this module stays independent of the driver layer; a caller hands it straight to `applyOutcome`. */
export interface ExplosionRunnerOutcome {
  readonly token: EventToken;
  readonly envelope: Envelope;
}

interface EmittedDoc {
  readonly path: string;
  readonly content: string;
}

// Mirrors `lib/graph-node-types/src/rad-orc/explosion.ts`'s own (unexported) `PHASE_HEADING`/
// `TASK_HEADING` regexes exactly — needed here only to re-locate the same anchor lines
// `parseMasterPlan` already validated, so this runner can slice out each phase's/task's verbatim
// body without `ParsedPhase`/`ParsedTask` carrying that text themselves (they don't).
const PHASE_HEADING = /^##\s+Phase\s+(\d+):\s*(.+)$/;
const TASK_HEADING = /^###\s+Task\s+(\d+):\s*(.+)$/;

function findHeadingLines(lines: readonly string[], pattern: RegExp, from: number, to: number): number[] {
  const indices: number[] = [];
  for (let i = from; i < to; i += 1) {
    if (pattern.test(lines[i].trim())) indices.push(i);
  }
  return indices;
}

function sliceLines(lines: readonly string[], start: number, end: number): string {
  return lines.slice(start, end).join('\n').trimEnd();
}

function extractNumber(pattern: RegExp, id: string, kind: 'phase' | 'task'): number {
  const match = pattern.exec(id);
  if (!match) throw new Error(`explosion-runner: unexpected ${kind} id shape "${id}"`);
  return Number(match[1]);
}

/** SCREAMING-KEBAB-CASE, mirroring the v6 `plan explode` doc-writer's own filename slugging. */
function slugify(title: string): string {
  const cleaned = title
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'UNTITLED';
}

/** `ParsedTask` carries no `docPath` — synthesized here, mirroring the v6 doc-writer's `tasks/P{NN}-T{MM}-{SLUG}.md` naming, keyed off the task's own declared phase/task numbers (not array position). */
function taskDocPath(phase: ParsedPhase, task: ParsedTask): string {
  const phaseNumber = extractNumber(/^phase-(\d+)$/, phase.id, 'phase');
  const taskNumber = extractNumber(/^phase-\d+-task-(\d+)$/, task.id, 'task');
  const nn = String(phaseNumber).padStart(2, '0');
  const mm = String(taskNumber).padStart(2, '0');
  return `tasks/P${nn}-T${mm}-${slugify(task.title)}.md`;
}

/**
 * Re-slices `sourceContent` — the raw master-plan markdown `parseMasterPlan` just accepted —
 * into one emitted doc per parsed phase (written to `ParsedPhase.docPath`) and one per parsed
 * task (written to a synthesized {@link taskDocPath}), each body the verbatim text between that
 * entity's own heading and the next sibling/parent heading. Walks the same heading anchors
 * `parseMasterPlan` walked, in the same order, so positional pairing with `parsed.phases`/
 * `phase.tasks` is safe.
 */
function emitDocs(sourceContent: string, parsed: ParsedMasterPlan): readonly EmittedDoc[] {
  const lines = sourceContent.split(/\r?\n/);
  const phaseHeadingLines = findHeadingLines(lines, PHASE_HEADING, 0, lines.length);
  const docs: EmittedDoc[] = [];

  parsed.phases.forEach((phase, phaseIndex) => {
    const start = phaseHeadingLines[phaseIndex];
    if (start === undefined) throw new Error(`explosion-runner: could not locate the heading for phase "${phase.id}" while re-slicing`);
    const end = phaseHeadingLines[phaseIndex + 1] ?? lines.length;
    docs.push({ path: phase.docPath, content: sliceLines(lines, start, end) });

    const taskHeadingLines = findHeadingLines(lines, TASK_HEADING, start, end);
    phase.tasks.forEach((task, taskIndex) => {
      const taskStart = taskHeadingLines[taskIndex];
      if (taskStart === undefined) throw new Error(`explosion-runner: could not locate the heading for task "${task.id}" while re-slicing`);
      const taskEnd = taskHeadingLines[taskIndex + 1] ?? end;
      docs.push({ path: taskDocPath(phase, task), content: sliceLines(lines, taskStart, taskEnd) });
    });
  });

  return docs;
}

/**
 * Backup-safe overwrite: only `docRead`/`docWrite` are available (no directory listing or move
 * port), so "back up the prior output" is done per emitted-doc-path rather than a whole-directory
 * move — if `targetPath` already holds content, that content is copied to
 * `backups/{backupStamp}/{targetPath}` before the fresh content lands, so a re-explode never
 * destructively overwrites a prior run's doc.
 */
async function backupExisting(ports: ExplosionRunnerPorts, originatingNodeId: NodeId, targetPath: string, backupStamp: string): Promise<void> {
  const existing = await ports.docRead.read({ path: targetPath });
  if (existing.outcome !== 'ok') return;
  const backupPath = `backups/${backupStamp}/${targetPath}`;
  await ports.docWrite.write({
    originatingNodeId,
    idempotencyKey: `${originatingNodeId}:backup:${targetPath}`,
    path: backupPath,
    content: existing.data.content,
  });
}

/**
 * Runs `rad-orc:explosion`'s real code-behind end to end: read the authored master-plan doc,
 * parse it, and — on a successful parse — back up then (re)write every emitted phase/task doc,
 * before handing back the `parsed`/`parse_failed` outcome `applyOutcome` feeds straight into the
 * node type's own `handle` (never mutates the graph/store itself; that stays the driver's job).
 */
export async function runExplosion(ports: ExplosionRunnerPorts, input: ExplosionRunnerInput): Promise<ExplosionRunnerOutcome> {
  const read = await ports.docRead.read({ path: input.masterPlanDocPath });
  const parsed = parseMasterPlan(read.data.content);

  if (parsed.outcome === 'error') {
    return {
      token: EXPLOSION_PARSE_FAILED_TOKEN,
      envelope: {
        outcome: 'error',
        data: {
          parseError: parsed.data,
          masterPlanNodeId: input.masterPlanNodeId,
          parseRetryCount: input.parseRetryCount,
        } satisfies ExplosionParseFailureData,
      },
    };
  }

  const docs = emitDocs(read.data.content, parsed.data);
  const backupStamp = (input._now ?? (() => new Date().toISOString()))().replace(/[:.]/g, '-');

  for (const doc of docs) {
    await backupExisting(ports, input.explosionNodeId, doc.path, backupStamp);
    await ports.docWrite.write({
      originatingNodeId: input.explosionNodeId,
      idempotencyKey: `${input.explosionNodeId}:write:${doc.path}`,
      path: doc.path,
      content: doc.content,
    });
  }

  return {
    token: EXPLOSION_PARSED_TOKEN,
    envelope: {
      outcome: 'ok',
      data: {
        parsed: parsed.data,
        cadence: input.cadence,
        planApprovalNodeId: input.planApprovalNodeId,
      } satisfies ExplosionParseSuccessData,
    },
  };
}
