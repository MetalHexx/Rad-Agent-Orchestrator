import type {
  ActContext,
  ActResult,
  DagNode,
  DataSchema,
  Envelope,
  EventToken,
  Expansion,
  HandleResult,
  NodeEvent,
  NodeId,
  NodeSpec,
  NodeStatus,
  NodeTypeDefinition,
  NodeTypeName,
  Presentation,
  ResolveContext,
  ResolveOutcome,
  RoutingRequest,
} from '@rad-orchestration/graph-engine';
import { PRIMITIVE_RESET, ROOT_NODE_ID } from '@rad-orchestration/graph-engine';

// ── Decoration cadence ───────────────────────────────────────────────────────────
/**
 * The declarative spec naming which review nodes decorate each phase and each task, plus the
 * one-time final spine. `explosion`'s code-behind returns parsed **values** only (see
 * {@link parseMasterPlan}); this cadence supplies the **structure** {@link buildExecutionExpansion}
 * decorates that parse with — so foreign code never invents routing shape, even here. Reached as
 * declared `data` on the `explosion` node itself (a fixture this iteration — see
 * `tests/fixtures/decoration-cadence.ts`).
 */
export interface DecorationCadence {
  /** Task-level reviews, attached as a chain of phase-children right after each task. */
  readonly perTask: readonly NodeTypeName[];
  /** Phase-level reviews, attached as a chain of phase-children right after its last task/review. */
  readonly perPhase: readonly NodeTypeName[];
  /** The one-time final spine (e.g. final code review → PR → final approval), root-level, after the last phase. */
  readonly spine: readonly NodeTypeName[];
}

// ── The sole code-behind: parsing the master plan into values ────────────────────
export interface ParsedTask {
  readonly id: string;
  readonly title: string;
}

export interface ParsedPhase {
  readonly id: string;
  readonly title: string;
  readonly docPath: string;
  readonly exitCriteria: readonly string[];
  readonly tasks: readonly ParsedTask[];
}

export interface ParsedMasterPlan {
  readonly phases: readonly ParsedPhase[];
}

/** Mirrors the parse-error shape the pre-DAG `explode_master_plan` CLI wrapper already emits. */
export interface MasterPlanParseFailure {
  readonly line: number;
  readonly expected: string;
  readonly found: string;
  readonly message: string;
}

const PHASE_HEADING = /^##\s+Phase\s+(\d+):\s*(.+)$/;
const TASK_HEADING = /^###\s+Task\s+(\d+):\s*(.+)$/;
const DOC_LINE = /^Doc:\s*(.+)$/;
const EXIT_CRITERIA_HEADING = /^Exit Criteria:$/;
const EXIT_CRITERION_ITEM = /^-\s+(.+)$/;
const PREAMBLE_HEADING = /^#\s+.+$/;

/**
 * `parseMasterPlan`'s own result type: a genuinely discriminated union (each arm's `outcome` is a
 * distinct literal), unlike `Envelope<TData>` itself — that type's `outcome` is the same
 * `EnvelopeOutcome` union on every instantiation, so `Envelope<A> | Envelope<B>` can't be narrowed
 * by a caller checking `outcome`. Each arm is still structurally an `Envelope<...>`.
 */
export type MasterPlanParseResult =
  | ({ readonly outcome: 'ok' } & Envelope<ParsedMasterPlan>)
  | ({ readonly outcome: 'error' } & Envelope<MasterPlanParseFailure>);

interface PhaseAccumulator {
  readonly number: number;
  readonly title: string;
  readonly headingLine: number;
  docPath: string | null;
  exitCriteria: string[];
  tasks: ParsedTask[];
}

function parseFailure(line: number, expected: string, found: string, message: string): Extract<MasterPlanParseResult, { outcome: 'error' }> {
  return { outcome: 'error', data: { line, expected, found, message } };
}

function closePhase(current: PhaseAccumulator): ParsedPhase | Extract<MasterPlanParseResult, { outcome: 'error' }> {
  if (current.docPath === null) {
    return parseFailure(
      current.headingLine,
      'a `Doc:` line before the next heading',
      'none',
      `phase ${current.number} ("${current.title}") never declared a \`Doc:\` line`,
    );
  }
  if (current.exitCriteria.length === 0) {
    return parseFailure(
      current.headingLine,
      'at least one `Exit Criteria:` bullet',
      'none',
      `phase ${current.number} ("${current.title}") declares no exit criteria`,
    );
  }
  if (current.tasks.length === 0) {
    return parseFailure(
      current.headingLine,
      'at least one `### Task` heading',
      'none',
      `phase ${current.number} ("${current.title}") declares no tasks`,
    );
  }
  return {
    id: `phase-${current.number}`,
    title: current.title,
    docPath: current.docPath,
    exitCriteria: current.exitCriteria,
    tasks: current.tasks,
  };
}

function isParseFailure(
  value: ParsedPhase | Extract<MasterPlanParseResult, { outcome: 'error' }>,
): value is Extract<MasterPlanParseResult, { outcome: 'error' }> {
  return 'outcome' in value;
}

/**
 * `explosion`'s sole code-behind: a deterministic, side-effect-free transform of the authored
 * master-plan doc's raw text into parsed **values** (never structure — see {@link DecorationCadence}).
 * Recognizes a small template shape: `## Phase N: Title` headings, each carrying a `Doc:` line, an
 * `Exit Criteria:` bullet list, and one or more `### Task N: Title` sub-headings. Rejects, with a
 * structured {@link MasterPlanParseFailure}, a task/content line before the first phase heading, a
 * phase missing its doc/exit-criteria/tasks, an unrecognized line inside a phase, or a doc with no
 * phases at all.
 */
export function parseMasterPlan(content: string): MasterPlanParseResult {
  const lines = content.split(/\r?\n/);
  const phases: ParsedPhase[] = [];
  let current: PhaseAccumulator | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    const lineNumber = i + 1;
    if (line.length === 0) continue;

    const phaseMatch = PHASE_HEADING.exec(line);
    if (phaseMatch) {
      if (current) {
        const closed = closePhase(current);
        if (isParseFailure(closed)) return closed;
        phases.push(closed);
      }
      current = { number: Number(phaseMatch[1]), title: phaseMatch[2].trim(), headingLine: lineNumber, docPath: null, exitCriteria: [], tasks: [] };
      continue;
    }

    if (!current) {
      if (PREAMBLE_HEADING.test(line)) continue; // a title/preamble heading before the first phase
      return parseFailure(lineNumber, 'a `## Phase N: Title` heading', line, 'content declared before the first phase heading');
    }

    const taskMatch = TASK_HEADING.exec(line);
    if (taskMatch) {
      current.tasks.push({ id: `phase-${current.number}-task-${taskMatch[1]}`, title: taskMatch[2].trim() });
      continue;
    }

    const docMatch = DOC_LINE.exec(line);
    if (docMatch) {
      current.docPath = docMatch[1].trim();
      continue;
    }

    if (EXIT_CRITERIA_HEADING.test(line)) continue; // marker only — bullets follow on subsequent lines

    const criterionMatch = EXIT_CRITERION_ITEM.exec(line);
    if (criterionMatch) {
      current.exitCriteria.push(criterionMatch[1].trim());
      continue;
    }

    return parseFailure(
      lineNumber,
      'a `Doc:` line, an `Exit Criteria:` bullet, or a `### Task` heading',
      line,
      `unrecognized line inside phase ${current.number}`,
    );
  }

  if (current) {
    const closed = closePhase(current);
    if (isParseFailure(closed)) return closed;
    phases.push(closed);
  }

  if (phases.length === 0) {
    return parseFailure(Math.max(lines.length, 1), 'at least one `## Phase N: Title` heading', 'none', 'master plan declares no phases');
  }

  return { outcome: 'ok', data: { phases } };
}

// ── Building the expand batch from parsed values + the decoration cadence ────────

function reviewKeySuffix(type: NodeTypeName): string {
  const [, name] = type.split(':');
  return name ?? type;
}

/**
 * The seam to get right: this function is 100% mechanical given `parsed` + `cadence` — it never
 * decides routing shape itself, only applies the cadence's declared structure to the parse's
 * declared values. A phase per parsed phase (contained by the root, chained phase-to-phase), a
 * task per parsed task (contained by its phase, chained task-to-task), `cadence.perTask` review(s)
 * chained after each task, `cadence.perPhase` review(s) chained after a phase's last task/review,
 * and `cadence.spine` chained once at the root after the last phase. The very first phase depends
 * on `planApprovalNodeId` — the whole seeded subgraph is gated behind the plan-level approval.
 */
export function buildExecutionExpansion(parsed: ParsedMasterPlan, cadence: DecorationCadence, planApprovalNodeId: NodeId): Expansion {
  const specs: NodeSpec[] = [];
  let previousPhaseAnchor: string | NodeId = planApprovalNodeId;

  for (const [phaseIndex, phase] of parsed.phases.entries()) {
    specs.push({
      key: phase.id,
      type: 'rad-orc:phase',
      parent: ROOT_NODE_ID,
      dependsOn: [previousPhaseAnchor],
      order: phaseIndex,
      data: { docPath: phase.docPath, exitCriteria: phase.exitCriteria },
    });

    let taskAnchor: string | null = null;
    for (const [taskIndex, task] of phase.tasks.entries()) {
      specs.push({
        key: task.id,
        type: 'rad-orc:task',
        parent: phase.id,
        dependsOn: taskAnchor ? [taskAnchor] : [],
        order: taskIndex,
        data: { title: task.title },
      });
      taskAnchor = task.id;

      for (const [reviewIndex, reviewType] of cadence.perTask.entries()) {
        const reviewKey = `${task.id}-${reviewKeySuffix(reviewType)}-${reviewIndex}`;
        specs.push({
          key: reviewKey,
          type: reviewType,
          parent: phase.id,
          dependsOn: [taskAnchor],
          data: { level: 'task' },
        });
        taskAnchor = reviewKey;
      }
    }

    let phaseAnchor = taskAnchor ?? phase.id;
    for (const [reviewIndex, reviewType] of cadence.perPhase.entries()) {
      const reviewKey = `${phase.id}-${reviewKeySuffix(reviewType)}-${reviewIndex}`;
      specs.push({
        key: reviewKey,
        type: reviewType,
        parent: phase.id,
        dependsOn: [phaseAnchor],
        data: { level: 'phase' },
      });
      phaseAnchor = reviewKey;
    }

    previousPhaseAnchor = phaseAnchor;
  }

  for (const [spineIndex, spineType] of cadence.spine.entries()) {
    const key = `spine-${reviewKeySuffix(spineType)}-${spineIndex}`;
    const isFinalLevel = spineType === 'rad-orc:approval' || spineType === 'rad-orc:code_review';
    specs.push({
      key,
      type: spineType,
      parent: ROOT_NODE_ID,
      dependsOn: [previousPhaseAnchor],
      data: isFinalLevel ? { level: 'final' } : {},
    });
    previousPhaseAnchor = key;
  }

  return { specs };
}

// ── Resolve: re-slicing the source doc + the doc-read/doc-write I/O ─────────────
// The host-side half of this node's own code-behind: given the raw master-plan markdown
// `parseMasterPlan` just accepted, re-slice it into one doc per parsed phase/task and write them
// (backing up any prior output first) via the `doc-read`/`doc-write` ports `resolve` declares.

interface EmittedDoc {
  readonly path: string;
  readonly content: string;
}

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
  if (!match) throw new Error(`rad-orc:explosion resolve: unexpected ${kind} id shape "${id}"`);
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
 * Re-slices `sourceContent` — the raw master-plan markdown `parseMasterPlan` just accepted — into
 * one emitted doc per parsed phase (written to `ParsedPhase.docPath`) and one per parsed task
 * (written to a synthesized {@link taskDocPath}), each body the verbatim text between that
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
    if (start === undefined) throw new Error(`rad-orc:explosion resolve: could not locate the heading for phase "${phase.id}" while re-slicing`);
    const end = phaseHeadingLines[phaseIndex + 1] ?? lines.length;
    docs.push({ path: phase.docPath, content: sliceLines(lines, start, end) });

    const taskHeadingLines = findHeadingLines(lines, TASK_HEADING, start, end);
    phase.tasks.forEach((task, taskIndex) => {
      const taskStart = taskHeadingLines[taskIndex];
      if (taskStart === undefined) throw new Error(`rad-orc:explosion resolve: could not locate the heading for task "${task.id}" while re-slicing`);
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
async function backupExisting(ctx: ResolveContext, targetPath: string, backupStamp: string): Promise<void> {
  const existing = await ctx.ports.docRead.read({ path: targetPath });
  if (existing.outcome !== 'ok') return;
  const backupPath = `backups/${backupStamp}/${targetPath}`;
  await ctx.ports.docWrite.write({
    originatingNodeId: ctx.nodeId,
    idempotencyKey: `${ctx.nodeId}:backup:${backupStamp}:${targetPath}`,
    path: backupPath,
    content: existing.data.content,
  });
}

function findMasterPlanSibling(nodes: readonly DagNode[]): DagNode {
  const node = nodes.find((n) => n.type === 'rad-orc:master_plan');
  if (!node) throw new Error('rad-orc:explosion resolve: no sibling rad-orc:master_plan node found in scope');
  return node;
}

function findPlanApprovalSibling(nodes: readonly DagNode[]): DagNode {
  const node = nodes.find((n) => n.type === 'rad-orc:approval' && n.data.level === 'plan');
  if (!node) throw new Error('rad-orc:explosion resolve: no plan-level sibling rad-orc:approval node found in scope');
  return node;
}

// ── The node type ──────────────────────────────────────────────────────────────

export const DEFAULT_PARSE_RETRY_LIMIT = 3;

/** Names this node type's own code-behind capability, via `CapabilityName`'s open string escape hatch. */
export const MASTER_PLAN_PARSER_CAPABILITY = 'rad-orc:master-plan-parser';

/** Fires once {@link parseMasterPlan} succeeds against the authored master-plan doc. */
export const EXPLOSION_PARSED_TOKEN: EventToken = 'rad-orc:explosion.parsed';
/** Fires once {@link parseMasterPlan} rejects the authored master-plan doc. */
export const EXPLOSION_PARSE_FAILED_TOKEN: EventToken = 'rad-orc:explosion.parse_failed';

/**
 * The envelope data `handle` expects on {@link EXPLOSION_PARSED_TOKEN}. `cadence`/
 * `planApprovalNodeId` ride alongside `parsed` for the same reason `approval.ts`'s
 * `ApprovalDecidedData` carries its own extra context: `handle` is pure over the event alone,
 * never this node's own persisted `data`, so whatever context building the expand batch needs
 * travels on the envelope.
 */
export interface ExplosionParseSuccessData {
  readonly parsed: ParsedMasterPlan;
  readonly cadence: DecorationCadence;
  readonly planApprovalNodeId: NodeId;
}

/** The envelope data `handle` expects on {@link EXPLOSION_PARSE_FAILED_TOKEN}. */
export interface ExplosionParseFailureData {
  readonly parseError: MasterPlanParseFailure;
  readonly masterPlanNodeId: NodeId;
  /** The retry count *before* this failure — `handle` increments it and compares against the configured cap. */
  readonly parseRetryCount: number;
}

export const EXPLOSION_DATA_SCHEMA: DataSchema = {
  cadence: {
    kind: 'object',
    level: 'required',
    description: 'Names which review nodes decorate each phase/task and the final spine (a fixture this iteration).',
  },
  parseRetryCount: {
    kind: 'number',
    level: 'computed',
    description: 'Running count of parse-failure retries against the configured cap.',
  },
  lastParseError: {
    kind: 'object',
    level: 'computed',
    description: 'The most recent parse failure detail, cleared on a successful parse.',
  },
  expanded: {
    kind: 'boolean',
    level: 'computed',
    description: 'Whether this node has already emitted its one expand batch — it never re-fires once execution starts.',
  },
};

const PRESENTATION: Presentation = {
  label: 'Explosion',
  description:
    'Parses the authored master plan into phases/tasks and seeds the decorated execution subgraph, gated behind the plan-level approval.',
};

const INSTRUCTIONS = `# rad-orc:explosion

The canonical \`expands\`-trait node and the engine's sole code-behind: a deterministic transform
(\`parseMasterPlan\`) turns the authored \`rad-orc:master_plan\` doc into parsed values, then this
node's own \`handle\` decorates those values with its declared \`cadence\` data to emit one
\`expand\` batch — a \`rad-orc:phase\` per parsed phase, a \`rad-orc:task\` per parsed task, plus
the review nodes the cadence names — gated behind the plan-level \`rad-orc:approval\`. Runs once,
after \`rad-orc:master_plan\` completes and before that approval; a parse failure or a plan-level
denial cascade-resets \`rad-orc:master_plan\` and this node re-runs fresh, under a parse-retry cap.
Never re-fires once the seeded subgraph starts executing.
`;

export interface ExplosionNodeTypeOptions {
  /** The parse-retry cap before a further failure stops re-requesting a fresh master plan. Host config; default {@link DEFAULT_PARSE_RETRY_LIMIT}. */
  readonly parseRetryLimit?: number;
  /**
   * The clock `resolve` stamps its backup path with (`backups/{now()}/...`). `resolve` runs
   * host-side, so calling `Date` directly is legal — this is a test seam only, mirroring
   * `parseRetryLimit`, so the backup-path test stays deterministic without a clock on
   * `ResolveContext` itself. Defaults to `() => new Date().toISOString()`.
   */
  readonly now?: () => string;
}

/**
 * Builds the `rad-orc:explosion` {@link NodeTypeDefinition}, closing over `options.parseRetryLimit`
 * (host config, default {@link DEFAULT_PARSE_RETRY_LIMIT}) so the cap is a construction-time
 * parameter rather than a hardcoded constant, and over `options.now` (the backup-stamp clock seam).
 */
export function createExplosionNodeType(options: ExplosionNodeTypeOptions = {}): NodeTypeDefinition {
  const parseRetryLimit = options.parseRetryLimit ?? DEFAULT_PARSE_RETRY_LIMIT;
  const now = options.now ?? (() => new Date().toISOString());

  function act(_ctx: ActContext): ActResult {
    return {
      instructions:
        "Parse the authored `rad-orc:master_plan` doc via this node's own code-behind parser " +
        '(`parseMasterPlan`), then feed the result back as `rad-orc:explosion.parsed` (success) or ' +
        '`rad-orc:explosion.parse_failed` (failure) — a deterministic transform, no operator or agent action.',
      executor: 'noop',
    };
  }

  function handle(ev: NodeEvent): HandleResult {
    if (ev.token === EXPLOSION_PARSED_TOKEN && ev.envelope.outcome === 'ok') {
      const { parsed, cadence, planApprovalNodeId } = ev.envelope.data as unknown as ExplosionParseSuccessData;
      return {
        dataChange: { parseRetryCount: 0, lastParseError: null, expanded: true },
        expansion: buildExecutionExpansion(parsed, cadence, planApprovalNodeId),
      };
    }

    if (ev.token === EXPLOSION_PARSE_FAILED_TOKEN && ev.envelope.outcome === 'error') {
      const { parseError, masterPlanNodeId, parseRetryCount } = ev.envelope.data as unknown as ExplosionParseFailureData;
      const nextCount = parseRetryCount + 1;
      if (nextCount > parseRetryLimit) {
        // Halts by excluding this node from the frontier (never re-firing the same failing parse
        // forever) and resets its own count at halt time — honoring core-opacity, since the engine
        // itself never touches `data` — so a later `resume` (clearing `disabled`) hands the
        // re-entering explosion a fresh full retry window rather than an already-exhausted one.
        return {
          dataChange: { parseRetryCount: 0, lastParseError: parseError },
          routing: { primitive: 'toggle', params: { node: ev.nodeId } },
        };
      }
      const routing: RoutingRequest = { primitive: PRIMITIVE_RESET, params: { node: masterPlanNodeId, cascade: true } };
      return { dataChange: { parseRetryCount: nextCount, lastParseError: parseError }, routing };
    }

    return {};
  }

  function projectStatus(data: Readonly<Record<string, unknown>>): NodeStatus {
    return data.expanded === true ? 'done' : 'not_started';
  }

  /**
   * This node's own host-side outcome derivation, reproducing the relocated `runExplosion` end to
   * end: read the authored master-plan doc, parse it, and — on a successful parse — back up then
   * (re)write every emitted phase/task doc, before handing back the `parsed`/`parse_failed`
   * outcome `handle` routes on. Reads only `ctx.nodes`/`ctx.data` and calls ports — it never
   * mutates the graph itself.
   */
  async function resolve(ctx: ResolveContext): Promise<ResolveOutcome> {
    const masterPlan = findMasterPlanSibling(ctx.nodes);
    const planApproval = findPlanApprovalSibling(ctx.nodes);
    const docPath = typeof masterPlan.data.docPath === 'string' ? masterPlan.data.docPath : '';
    const cadence = ctx.data.cadence as DecorationCadence;
    const parseRetryCount = typeof ctx.data.parseRetryCount === 'number' ? ctx.data.parseRetryCount : 0;

    const read = await ctx.ports.docRead.read({ path: docPath });
    const parsed = parseMasterPlan(read.data.content);

    if (parsed.outcome === 'error') {
      return {
        token: EXPLOSION_PARSE_FAILED_TOKEN,
        envelope: {
          outcome: 'error',
          data: {
            parseError: parsed.data,
            masterPlanNodeId: masterPlan.id,
            parseRetryCount,
          } satisfies ExplosionParseFailureData,
        },
      };
    }

    const docs = emitDocs(read.data.content, parsed.data);
    const backupStamp = now().replace(/[:.]/g, '-');

    for (const doc of docs) {
      await backupExisting(ctx, doc.path, backupStamp);
      await ctx.ports.docWrite.write({
        originatingNodeId: ctx.nodeId,
        idempotencyKey: `${ctx.nodeId}:write:${doc.path}`,
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
          cadence,
          planApprovalNodeId: planApproval.id,
        } satisfies ExplosionParseSuccessData,
      },
    };
  }

  return {
    name: 'rad-orc:explosion',
    dataSchema: EXPLOSION_DATA_SCHEMA,
    traits: ['expands'],
    capabilities: [MASTER_PLAN_PARSER_CAPABILITY, 'doc-read', 'doc-write'],
    presentation: PRESENTATION,
    instructions: INSTRUCTIONS,
    act,
    handle,
    projectStatus,
    resolve,
  };
}

export const EXPLOSION_NODE_TYPE: NodeTypeDefinition = createExplosionNodeType();
