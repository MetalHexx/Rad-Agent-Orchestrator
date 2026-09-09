import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadTemplate } from './template-loader.js';
import { resolveTemplateName, snapshotTemplate } from './template-resolver.js';
import { preRead } from './pre-reads.js';
import { getMutation } from './mutations.js';
import { walkDAG, resolveNodeStatePath, deriveCurrentNodePathFromMarkers } from './dag-walker.js';
import { enrichActionContext, repoNamesFromState } from './context-enrichment.js';
import { resolveDocPaths } from './resolve-doc-paths.js';
import { EVENTS, OUT_OF_BAND_EVENTS } from './constants.js';
import { composeActionPrompt, composeOrphanRuntimeShape, NEXT_ACTION_PLACEHOLDER } from './composer.js';
import { parseActionEventFile } from './action-event-loader.js';
import type { ActionFrontmatter, EventFrontmatter } from './action-event-loader.js';
import { buildCompletionCommands, buildSignalGuidance } from './completion-commands.js';
import { userDataPaths } from '../paths.js';
import type {
  PipelineState,
  PipelineResult,
  PipelineTemplate,
  OrchestrationConfig,
  EventContext,
  IOAdapter,
  NodeDef,
  NodeState,
  PathContext,
} from './types.js';
import { scaffoldNodeState } from './scaffold.js';
import { validateState } from './validator.js';
import { CURRENT_SCHEMA_VERSION } from './migrations/version.js';

// Canonical user-data projects directory. Mirrors cli/src/lib/upgrade/user-data-paths.ts
// (userDataPaths().projects); inlined here because the pipeline runtime in
// skills/rad-orchestration/scripts/ has no shared TS surface with cli/.
const PROJECTS_BASE_PATH = path.join(os.homedir(), '.radorc', 'projects');

// ── Catalog-root resolution (FR-4, AD-6) ─────────────────────────────────────
// Production reads the action/event catalog root from `userDataPaths().actionEvents`.
// Two override surfaces exist:
//   - `__setActionEventsRootForTests(dir)` — in-process test seam, used by the
//     behavioral-suite helper at `cli/tests/behavioral/pipeline/helpers/catalog.ts`.
//   - `RADORCH_ACTION_EVENTS_DIR` env var — out-of-process override for tests
//     that spawn the bundled CLI as a subprocess (mirrors the existing
//     `RADORCH_TEMPLATES_DIR` env var in `path-context.ts`).
// Both are deliberate test seams; production callers rely on the user-data path.
let __actionEventsRootOverride: string | null = null;
export function __setActionEventsRootForTests(root: string | null): void {
  __actionEventsRootOverride = root;
}
function resolveActionEventsRoot(): string {
  if (__actionEventsRootOverride !== null) return __actionEventsRootOverride;
  const envOverride = process.env['RADORCH_ACTION_EVENTS_DIR'];
  if (envOverride) return envOverride;
  return userDataPaths().actionEvents;
}

/**
 * Cold-read the catalog action file's frontmatter. Returns `undefined` if the
 * file does not exist on disk — callers treat this as "skip prompt attachment"
 * (the catalog will be populated incrementally; missing files must not break
 * success envelope routing). All other parse errors propagate.
 */
function readActionFrontmatter(actionName: string): ActionFrontmatter | undefined {
  const root = resolveActionEventsRoot();
  const filename = `action.${actionName}.md`;
  const filePath = path.join(root, filename);
  if (!fs.existsSync(filePath)) return undefined;
  const text = fs.readFileSync(filePath, 'utf8');
  const parsed = parseActionEventFile(text, filename);
  if (parsed.kind !== 'action') {
    throw new Error(`Catalog file '${filePath}' parsed kind '${parsed.kind}' but action expected.`);
  }
  return parsed.frontmatter as ActionFrontmatter;
}

/** Every event the action can finish by signalling: its completion event first,
 *  then each alternate outcome in declaration order. */
function declaredEvents(fm: ActionFrontmatter): string[] {
  if (fm.completion_event === null) return [];
  return [fm.completion_event, ...(fm.alternate_outcomes ?? []).map(o => o.event)];
}

/**
 * Read each named event's `signal_payload` from the same catalog root the
 * composer reads. An action naming an event with no file on disk is a catalog
 * error, reported by the file the operator has to author — the same failure the
 * composer raises for a missing completion-event file, extended to the
 * alternate outcomes the composer never reads.
 */
function resolveSignalPayloads(eventNames: string[]): Record<string, EventFrontmatter['signal_payload']> {
  const root = resolveActionEventsRoot();
  const payloads: Record<string, EventFrontmatter['signal_payload']> = {};
  for (const eventName of eventNames) {
    const filename = `event.${eventName}.md`;
    const filePath = path.join(root, filename);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Catalog validation: expected catalog file '${filename}' under '${root}'.`);
    }
    const parsed = parseActionEventFile(fs.readFileSync(filePath, 'utf8'), filename);
    if (parsed.kind !== 'event') {
      throw new Error(`Catalog file '${filePath}' parsed kind '${parsed.kind}' but event expected.`);
    }
    payloads[eventName] = (parsed.frontmatter as EventFrontmatter).signal_payload ?? {};
  }
  return payloads;
}

// Flag name → the enriched-context key carrying its value. The two names differ
// (`--phase` reads context `phase_number`), so the mapping is declared rather
// than derived. Filling these is what keeps a rendered command correct when the
// engine's auto-resolution would otherwise have to guess.
const KNOWN_FLAG_CONTEXT_KEYS: Record<string, string> = {
  phase: 'phase_number',
  task: 'task_number',
};

/** Flag-name → literal value for every flag the resolved context already
 *  answers. A null or absent context value leaves the flag unknown. */
function knownFlagValues(context: Record<string, unknown>): Record<string, string> {
  const known: Record<string, string> = {};
  for (const [flag, contextKey] of Object.entries(KNOWN_FLAG_CONTEXT_KEYS)) {
    const value = context[contextKey];
    if (typeof value === 'number' && Number.isFinite(value)) known[flag] = String(value);
    else if (typeof value === 'string' && value.length > 0) known[flag] = value;
  }
  return known;
}

// Flags that exist only when the task was directed to commit. Hardcoded beside
// KNOWN_FLAG_CONTEXT_KEYS rather than declared in the catalog for the same
// reason: the fact that decides them already rides the resolved context, and a
// catalog condition language would restate it and invite drift.
const COMMIT_CONDITIONAL_FLAGS = ['branch', 'repos'];

/**
 * Flag names this invocation must not carry at all — contextually inapplicable,
 * so the renderer drops them rather than emitting a `<fill-in: …>` marker the
 * orchestrator would have to decide against the standing "never drop" rule.
 *
 * Both rules read the run context, not the schema. Schema-optionality only marks
 * a flag as *eligible* to vary, and `--branch`/`--repos` on a normal commit task
 * are the proof: also optional, and genuinely the orchestrator's to supply.
 *
 * - The engine-owned identity flags are the exact complement of `known`: the
 *   engine is their only possible source, so unknown here means the value does
 *   not exist. A final-scope corrective owns no phase and no task iteration; a
 *   phase-scope corrective owns no task. Their catalog descriptions already
 *   promise auto-resolution when omitted, so dropping them costs nothing.
 * - The commit-conditional flags go when `should_commit` is explicitly false
 *   (`source_control.auto_commit: never`). Strictly `=== false`, so an action
 *   whose context carries no `should_commit` at all omits nothing. Note this is
 *   config-derived, not "did a commit happen": a dispute-only corrective commits
 *   nothing yet still reports `committed: false` per repo, so its flags stay.
 */
function omittedFlags(context: Record<string, unknown>, known: Record<string, string>): string[] {
  const omit = Object.keys(KNOWN_FLAG_CONTEXT_KEYS).filter((flag) => !(flag in known));
  if (context['should_commit'] === false) omit.push(...COMMIT_CONDITIONAL_FLAGS);
  return omit;
}

/**
 * Returns true iff `eventName` is an orphan event — no action in the catalog
 * declares it as its `completion_event`. Used by `attachPromptIfActionResolved`
 * to decide whether to prepend the firing event's post content to the next
 * action's composed prompt. For non-orphan events the existing composer flow
 * already places event.X.post in the bracketing action's prompt, so the
 * prepend would be redundant.
 */
export function isOrphanEvent(eventName: string): boolean {
  const root = resolveActionEventsRoot();
  if (!fs.existsSync(root)) return true;
  const actionFiles = fs.readdirSync(root).filter((f) => /^action\..+\.md$/.test(f));
  for (const filename of actionFiles) {
    try {
      const parsed = parseActionEventFile(fs.readFileSync(path.join(root, filename), 'utf8'), filename);
      if (parsed.kind !== 'action') continue;
      const fm = parsed.frontmatter as { kind: 'action'; completion_event: string | null };
      if (fm.completion_event === eventName) return false;
    } catch {
      // Malformed catalog file — skip; same forgiveness as listCatalogEntries.
    }
  }
  return true;
}

/**
 * Reads `<catalogRoot>/custom/event.<eventName>.post.md`. Returns the trimmed
 * body if the file exists and is non-empty after trim; null otherwise.
 */
export function readOrphanPostContent(eventName: string): string | null {
  const fp = path.join(resolveActionEventsRoot(), 'custom', `event.${eventName}.post.md`);
  if (!fs.existsSync(fp)) return null;
  const raw = fs.readFileSync(fp, 'utf8').trim();
  return raw.length > 0 ? raw : null;
}

/**
 * Attach `prompt` (composed catalog text), `completion_event` (resolved event
 * name) and `completion_commands` (one runnable command per way the action can
 * finish by signalling) to the engine's success envelope. These fields live
 * inside `data` alongside `action` and `context` — they are NOT nested inside
 * `context`. Failure envelopes never reach this helper — they construct their
 * result inline with the `error: { ... }` field.
 *
 * Skips prompt composition entirely when there is no next action, and when the
 * action's catalog file does not exist on disk; the envelope still surfaces
 * `action`, the enriched context and an empty `completion_commands` so
 * downstream consumers that do not depend on the composed prompt continue to
 * operate (catalog population proceeds independently of pipeline routing).
 *
 * When the firing event is an orphan event with a non-empty custom-post
 * overlay, the orphan-post body is prepended under `## Step 1` via
 * `composeOrphanRuntimeShape`, and the downstream action's composed sections
 * renumber from `## Step 2` via `composeActionPrompt({ startStep: 2 })`.
 * The success envelope's `has_custom_instructions` flag reflects whether the
 * orphan-post overlay (or any downstream overlay) contributed content.
 *
 * @param scriptPath - Absolute path of the running radorch script, from
 *   `PathContext`. The renderer needs it to emit a cwd-independent command.
 * @param repoNames - Repo names from state, for the repos-array skeleton.
 */
export function attachPromptIfActionResolved(
  next: { action: string; context: Record<string, unknown> } | null,
  template: PipelineTemplate,
  firingEvent: string,
  projectDir: string,
  scriptPath: string,
  repoNames: string[],
): PipelineResult {
  if (!next) return { action: null, context: {}, completion_commands: [] };
  const resolvedProjectDir = path.resolve(projectDir);
  next.context = resolveDocPaths(next.context, resolvedProjectDir);
  const actionFm = readActionFrontmatter(next.action);
  if (actionFm === undefined) {
    return { action: next.action, context: next.context, completion_commands: [] };
  }
  const completion_event = actionFm.completion_event;
  const payloads = resolveSignalPayloads(declaredEvents(actionFm));
  const known = knownFlagValues(next.context);
  const omit = omittedFlags(next.context, known);
  const completion_commands = buildCompletionCommands({
    action: actionFm,
    payloads,
    scriptPath,
    projectDir: resolvedProjectDir,
    known,
    omit,
    repoNames,
  });
  // No command means nothing for the orchestrator to run, so the composed
  // prompt falls back to the shape-only block.
  const signalGuidance = completion_commands.length > 0
    ? buildSignalGuidance(completion_commands, payloads, known)
    : undefined;
  const catalogRoot = resolveActionEventsRoot();
  let prompt: string;
  let has_custom_instructions: boolean;
  if (isOrphanEvent(firingEvent)) {
    const orphanShape = composeOrphanRuntimeShape({ eventName: firingEvent, catalogRoot });
    if (orphanShape.has_custom_instructions) {
      // Step 1 = orphan-post; downstream action sections renumber from Step 2.
      const downstream = composeActionPrompt({
        actionName: next.action,
        completionEvent: completion_event,
        catalogRoot,
        startStep: 2,
        signalGuidance,
      });
      prompt = orphanShape.prompt.replace(NEXT_ACTION_PLACEHOLDER, downstream.prompt);
      has_custom_instructions = true; // orphan-post admitted, regardless of downstream overlay
    } else {
      const composed = composeActionPrompt({
        actionName: next.action,
        completionEvent: completion_event,
        catalogRoot,
        signalGuidance,
      });
      prompt = composed.prompt;
      has_custom_instructions = composed.has_custom_instructions;
    }
  } else {
    const composed = composeActionPrompt({
      actionName: next.action,
      completionEvent: completion_event,
      catalogRoot,
      signalGuidance,
    });
    prompt = composed.prompt;
    has_custom_instructions = composed.has_custom_instructions;
  }
  return {
    action: next.action,
    context: next.context,
    prompt,
    completion_event,
    has_custom_instructions,
    completion_commands,
  };
}

// ── scaffoldState ─────────────────────────────────────────────────────────────

function scaffoldState(
  template: PipelineTemplate,
  projectName: string,
  config: OrchestrationConfig,
): PipelineState {
  const now = new Date().toISOString();
  const nodes: Record<string, NodeState> = {};

  for (const node of template.nodes) {
    nodes[node.id] = scaffoldNodeState(node);
  }

  return {
    $schema: CURRENT_SCHEMA_VERSION,
    project: {
      name: projectName,
      created: now,
      updated: now,
    },
    config: {
      gate_mode: config.human_gates.execution_mode,
      limits: {
        max_retries_per_task: config.limits.max_retries_per_task,
      },
      source_control: {
        auto_commit: config.source_control.auto_commit,
        auto_pr: config.source_control.auto_pr,
      },
    },
    pipeline: {
      gate_mode: null,
      source_control: null,
      current_tier: 'planning',
      halt_reason: null,
    },
    graph: {
      template_id: template.template.id,
      status: 'in_progress',
      current_node_path: null,
      nodes,
    },
  };
}

// ── Document path containment ────────────────────────────────────────────────

/**
 * Resolve a document path for filesystem access. An absolute path is taken as
 * given; a relative one resolves against the project directory and may not
 * climb out of it.
 *
 * @throws when a relative path escapes the project directory.
 */
function resolveContainedDocPath(docPath: string, projectDir: string): string {
  if (path.isAbsolute(docPath)) return docPath;

  const resolvedProjectDir = path.resolve(projectDir);
  const resolved = path.resolve(resolvedProjectDir, docPath);
  const relativeToProject = path.relative(resolvedProjectDir, resolved);

  if (relativeToProject === '..' || relativeToProject.startsWith(`..${path.sep}`) || path.isAbsolute(relativeToProject)) {
    throw new Error(`Document path escapes project directory: ${docPath}`);
  }
  return resolved;
}

// ── Operator change request → final review report finding ────────────────────

/** Heading that both renders the operator's finding and tags it with the
 *  corrective entry it births. The tag is what makes the append idempotent: the
 *  report write and the state write are two operations, so a crash between them
 *  is recovered by re-signalling, and the re-signal must not append twice. */
function operatorFindingHeading(correctiveIndex: number): string {
  return `### Finding — Operator change request (corrective ${correctiveIndex})`;
}

/**
 * Insert a finding at the end of the report's `## Findings` section, or append
 * that section when the report carries none. Everything outside the insertion
 * point survives verbatim, including the report's own line endings — the
 * reviewer owns this document and the engine is only adding to it.
 */
function withOperatorFinding(existing: string, heading: string, reason: string): string {
  const eol = existing.includes('\r\n') ? '\r\n' : '\n';
  const block = `${heading}${eol}${eol}${reason}${eol}`;

  const findingsHeading = /^##[ \t]+Findings[ \t]*\r?$/m.exec(existing);
  if (findingsHeading === null) {
    const body = existing.replace(/\s+$/, '');
    const prefix = body.length === 0 ? '' : `${body}${eol}${eol}`;
    return `${prefix}## Findings${eol}${eol}${block}`;
  }

  const sectionStart = findingsHeading.index + findingsHeading[0].length;
  const nextSection = /^##[ \t]/m.exec(existing.slice(sectionStart));
  const insertAt = nextSection === null ? existing.length : sectionStart + nextSection.index;
  const before = existing.slice(0, insertAt).replace(/\s+$/, '');
  const after = existing.slice(insertAt);
  return after.length === 0
    ? `${before}${eol}${eol}${block}`
    : `${before}${eol}${eol}${block}${eol}${after}`;
}

/**
 * Compose the operator's objection as a finding on the running final review
 * report. Returns the contents to commit, or null when the report already
 * carries the finding for the corrective this request births.
 *
 * Called BEFORE the mutation so an unreadable report aborts the signal with
 * nothing written; the returned contents are committed only once the post-walk
 * validation has passed (see the out-of-band branch).
 *
 * @throws when `final_review.doc_path` names no report, or names one that is
 *   not on disk. The running report is the contract — inventing one would hand
 *   the coder a report the reviewer never wrote.
 */
function stageOperatorFinding(
  state: PipelineState,
  reason: string,
  projectDir: string,
  io: IOAdapter,
): { docPath: string; contents: string } | null {
  const node = state.graph.nodes['final_review'];
  if (node === undefined || node.kind !== 'step' || typeof node.doc_path !== 'string' || node.doc_path.trim().length === 0) {
    throw new Error(
      'final_corrective_requested: final_review names no report, so there is no running final review ' +
      'report to record the change request in. The request was not applied.'
    );
  }

  const resolved = resolveContainedDocPath(node.doc_path, projectDir);
  const existing = io.readDocumentRaw(resolved);
  if (existing === null) {
    throw new Error(
      `final_corrective_requested: the final review report at '${node.doc_path}' is missing. The ` +
      `running report is the contract for a corrective, so the request was not applied and no report ` +
      `was created in its place.`
    );
  }

  const heading = operatorFindingHeading((node.corrective_tasks ?? []).length + 1);
  if (existing.includes(heading)) return null;
  return { docPath: resolved, contents: withOperatorFinding(existing, heading, reason) };
}

// ── normalizeDocPath ────────────────────────────────────────────────────────────

export function normalizeDocPath(docPath: string, basePath: string, projectName: string): string {
  if (!docPath) return docPath;
  const normalized = docPath.replace(/\\/g, '/');
  const normalizedBase = basePath.replace(/\\/g, '/');
  const prefix = normalizedBase + '/' + projectName + '/';
  if (normalized.toLowerCase().startsWith(prefix.toLowerCase())) return normalized.slice(prefix.length);
  return normalized;
}

// ── resolveGateApproved ───────────────────────────────────────────────────────

function resolveGateApproved(context: Partial<EventContext>): string {
  const gateType = (context as Record<string, unknown>).gate_type;
  if (gateType === 'task') return 'task_gate_approved';
  if (gateType === 'phase') return 'phase_gate_approved';
  throw new Error(gateType
    ? `Unknown gate type '${gateType}': expected task or phase`
    : 'gate_approved requires --gate-type task|phase');
}

// ── processEvent (main engine entry point) ────────────────────────────────────

export function processEvent(
  event: string,
  projectDir: string,
  context: Partial<EventContext>,
  io: IOAdapter,
  pathContext: PathContext,
  configPath?: string,
): PipelineResult {
  const { templatesDir } = pathContext;

  try {
    const config = io.readConfig(configPath);

    const state = io.readState(projectDir);

    const resolution = resolveTemplateName(state, context.template, config, projectDir, templatesDir);
    // For new-project creation (state === null) always load from the global templates directory.
    // This avoids reading a project-local snapshot that may be mid-write in concurrent scenarios
    // or stale from a prior failed run. The snapshot step below overwrites any stale file.
    const effectiveLoadPath = state !== null
      ? resolution.templatePath
      : path.join(templatesDir, resolution.templateName + '.yml');
    const loadedTemplate = loadTemplate(effectiveLoadPath);
    const { template, eventIndex } = loadedTemplate;

    const wrappedReadDocument = (docPath: string) =>
      io.readDocument(resolveContainedDocPath(docPath, projectDir));

    // ── Start event (pre-index routing) ────────────────────────────────
    if (event === 'start') {
      if (state === null) {
        const projectName = path.basename(projectDir);
        io.ensureDirectories(projectDir);
        // Always snapshot the global template for new projects. This also handles
        // the stale re-start case where a prior failed run left template.yml but
        // no state.json — the stale file is overwritten with the correct global template.
        try {
          snapshotTemplate(
            path.join(templatesDir, resolution.templateName + '.yml'),
            projectDir,
          );
        } catch (err) {
          console.error('[engine] snapshotTemplate failed; project will use global template on future events:', err);
        }
        const scaffolded = scaffoldState(template, projectName, config);
        scaffolded.project.updated = new Date().toISOString();

        const nextAction = walkDAG(scaffolded, template, config, wrappedReadDocument);

        const postWalkErrors = validateState(null, scaffolded, config, template);
        if (postWalkErrors.length > 0) {
          return {
            action: null,
            context: { error: postWalkErrors[0] },
            error: {
              message: postWalkErrors[0],
              event,
            },
          };
        }

        io.writeState(projectDir, scaffolded);

        const enrichedContext = nextAction
          ? enrichActionContext({
              action: nextAction.action,
              walkerContext: nextAction.context,
              state: scaffolded,
              config,
              cliContext: context,
            })
          : {};

        return attachPromptIfActionResolved(
          nextAction ? { action: nextAction.action, context: enrichedContext } : null,
          template,
          event,
          projectDir,
          pathContext.scriptPath,
          repoNamesFromState(scaffolded),
        );
      } else {
        const walkerResult = walkDAG(state, template, config, wrappedReadDocument);

        state.project.updated = new Date().toISOString();

        // Derive current_node_path from in_progress markers AFTER the walker has
        // advanced any newly-activated nodes — the honesty tripwire below is a
        // post-recompute invariant, and resume is a post-walk validate site like
        // any other. Falls back to the echoed cursor when no concrete in_progress
        // leaf exists (terminal / gate-pending states).
        state.graph.current_node_path =
          deriveCurrentNodePathFromMarkers(state) ?? state.graph.current_node_path;

        const validationErrors = validateState(null, state, config, template);
        if (validationErrors.length > 0) {
          return {
            action: null,
            context: { error: validationErrors[0] },
            error: { message: validationErrors[0], event },
          };
        }

        io.writeState(projectDir, state);

        const enrichedContext = walkerResult
          ? enrichActionContext({
              action: walkerResult.action,
              walkerContext: walkerResult.context,
              state,
              config,
              cliContext: context,
            })
          : {};
        return attachPromptIfActionResolved(
          walkerResult ? { action: walkerResult.action, context: enrichedContext } : null,
          template,
          event,
          projectDir,
          pathContext.scriptPath,
          repoNamesFromState(state),
        );
      }
    }

    // ── Null-state guard (non-start events) ────────────────────────────
    if (state === null) {
      return {
        action: null,
        context: { error: 'No state.json found; use --event start' },
        error: {
          message: 'No state.json found; use --event start',
          event,
        },
      };
    }
    // ── Out-of-band event routing (pre-index) ──────────────────────────
    if (OUT_OF_BAND_EVENTS.has(event)) {
      const mutation = getMutation(event);
      // Defensive guard: every OUT_OF_BAND_EVENTS entry is unconditionally registered in mutations.ts,
      // so this branch is currently unreachable. Retained as a safety net against future deregistration.
      if (!mutation) {
        return {
          action: null,
          context: { error: `No mutation registered for event: ${event}` },
          error: { message: `No mutation registered for event: ${event}`, event },
        };
      }

      const normalizedContext = { ...context };
      if (normalizedContext.doc_path) {
        normalizedContext.doc_path = normalizeDocPath(
          normalizedContext.doc_path,
          PROJECTS_BASE_PATH,
          path.basename(projectDir),
        );
      }

      // Composed before the mutation so an unreadable report aborts with nothing
      // written; committed after the post-walk validation, because both validate
      // sites below return an error envelope with no state written at all — an
      // append made here would outlive a corrective that was never born. A blank
      // reason is left to the mutation to reject, so its error is not masked by
      // a report problem the operator cannot act on yet.
      const operatorReason = (normalizedContext.reason ?? '').trim();
      const stagedFinding = event === EVENTS.FINAL_CORRECTIVE_REQUESTED && operatorReason.length > 0
        ? stageOperatorFinding(state, operatorReason, projectDir, io)
        : null;

      const mutationResult = mutation(state, normalizedContext, config, template);
      const mutatedState = mutationResult.state;

      // Pre-walk: skip the current_node_path honesty tripwire — the cursor is
      // recomputed post-walk (see below), so it is intentionally stale here.
      const validationErrors = validateState(state, mutatedState, config, template, { checkCursorHonesty: false });
      if (validationErrors.length > 0) {
        return {
          action: null,
          context: { error: validationErrors[0] },
          error: { message: validationErrors[0], event },
        };
      }

      mutatedState.project.updated = new Date().toISOString();

      const walkerResult = walkDAG(mutatedState, template, config, wrappedReadDocument);

      // Derive current_node_path from in_progress markers AFTER the walker has
      // advanced any newly-activated nodes. FR-8, AD-1. A blocking boolean
      // human approval gate (plan_approval_gate, final_approval_gate) is now
      // a concrete leaf the derivation can land on even before the phase loop
      // is seeded, so the fallback below is no longer reached at those gates.
      mutatedState.graph.current_node_path =
        deriveCurrentNodePathFromMarkers(mutatedState) ?? mutatedState.graph.current_node_path;

      const postWalkErrors = validateState(state, mutatedState, config, template);
      if (postWalkErrors.length > 0) {
        return {
          action: null,
          context: { error: postWalkErrors[0] },
          error: { message: postWalkErrors[0], event },
        };
      }

      // Report first, state second. The two cannot be one atomic write, and this
      // is the recoverable order: a crash in between leaves a finding whose
      // corrective was never born, which re-signalling completes — the finding's
      // corrective-index tag makes the second append a no-op.
      if (stagedFinding !== null) {
        io.writeDocument(stagedFinding.docPath, stagedFinding.contents);
      }

      io.writeState(projectDir, mutatedState);

      const enrichedContext = walkerResult
        ? enrichActionContext({
            action: walkerResult.action,
            walkerContext: walkerResult.context,
            state: mutatedState,
            config,
            cliContext: context,
          })
        : {};

      return attachPromptIfActionResolved(
        walkerResult ? { action: walkerResult.action, context: enrichedContext } : null,
        template,
        event,
        projectDir,
        pathContext.scriptPath,
        repoNamesFromState(mutatedState),
      );
    }

    // ── gate_approved alias resolution ──────────────────────────────────
    if (event === 'gate_approved') {
      try {
        event = resolveGateApproved(context);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          action: null,
          context: { error: message },
          error: {
            message,
            event,
          },
        };
      }
    }
    // ── Standard route (state exists) ───────────────────────────────────
    const entry = eventIndex.get(event);
    if (!entry) {
      return {
        action: null,
        context: { error: `Unknown event: ${event}` },
        error: {
          message: `Unknown event: ${event}`,
          event,
        },
      };
    }
    const preReadResult = preRead(event, context, io.readDocument, projectDir, state, entry);
    if (preReadResult.error) {
      return {
        action: null,
        context: { error: preReadResult.error.message },
        error: preReadResult.error,
      };
    }

    const mutation = getMutation(event);
    if (!mutation) {
      return {
        action: null,
        context: { error: `No mutation registered for event: ${event}` },
        error: {
          message: `No mutation registered for event: ${event}`,
          event,
        },
      };
    }

    const normalizedContext = { ...preReadResult.context };
    if (normalizedContext.doc_path) {
      normalizedContext.doc_path = normalizeDocPath(
        normalizedContext.doc_path,
        PROJECTS_BASE_PATH,
        path.basename(projectDir),
      );
    }
    const mutationResult = mutation(state, normalizedContext, config, template);
    const mutatedState = mutationResult.state;

    // Pre-walk: skip the current_node_path honesty tripwire — the cursor is
    // recomputed post-walk (see below), so it is intentionally stale here.
    const validationErrors = validateState(state, mutatedState, config, template, { checkCursorHonesty: false });
    if (validationErrors.length > 0) {
      return {
        action: null,
        context: { error: validationErrors[0] },
        error: {
          message: validationErrors[0],
          event,
        },
      };
    }

    mutatedState.project.updated = new Date().toISOString();

    // Per FR-11, all routed events now fall through to the walker; the
    // former `entry.eventPhase === 'started'` short-circuit is gone.
    let nextAction;
    {
      const walkerResult = walkDAG(mutatedState, template, config, wrappedReadDocument);

      // Derive current_node_path from in_progress markers AFTER the walker has
      // advanced any newly-activated nodes, so the cursor always reflects the
      // post-walk state. Falls back to the echo-based path when no concrete
      // in_progress leaf exists (terminal / gate-pending states). FR-8, AD-1.
      // A blocking boolean human approval gate (plan_approval_gate,
      // final_approval_gate) is now a concrete leaf the derivation can land
      // on even before the phase loop is seeded, so the fallback below is no
      // longer reached at those gates.
      mutatedState.graph.current_node_path =
        deriveCurrentNodePathFromMarkers(mutatedState) ?? resolveNodeStatePath(entry.templatePath, context);

      const postWalkErrors = validateState(state, mutatedState, config, template);
      if (postWalkErrors.length > 0) {
        return {
          action: null,
          context: { error: postWalkErrors[0] },
          error: {
            message: postWalkErrors[0],
            event,
          },
        };
      }

      io.writeState(projectDir, mutatedState);

      if (walkerResult) {
        nextAction = {
          action: walkerResult.action,
          context: enrichActionContext({
            action: walkerResult.action,
            walkerContext: walkerResult.context,
            state: mutatedState,
            config,
            cliContext: context,
          }),
        };
      } else {
        nextAction = walkerResult;
      }
    }

    return attachPromptIfActionResolved(
      nextAction ?? null,
      template,
      event,
      projectDir,
      pathContext.scriptPath,
      repoNamesFromState(mutatedState),
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      action: null,
      context: { error: message },
      error: {
        message,
        event,
      },
    };
  }
}
