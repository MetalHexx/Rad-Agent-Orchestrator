import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadTemplate } from './template-loader.js';
import { resolveTemplateName, snapshotTemplate } from './template-resolver.js';
import { preRead } from './pre-reads.js';
import { getMutation } from './mutations.js';
import { walkDAG, resolveNodeStatePath, deriveCurrentNodePathFromMarkers } from './dag-walker.js';
import { enrichActionContext } from './context-enrichment.js';
import { resolveDocPaths } from './resolve-doc-paths.js';
import { OUT_OF_BAND_EVENTS } from './constants.js';
import { composeActionPrompt, composeOrphanRuntimeShape, NEXT_ACTION_PLACEHOLDER } from './composer.js';
import { parseActionEventFile } from './action-event-loader.js';
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
 * Cold-read the catalog action file's frontmatter (AD-6) and return its
 * `completion_event` field. Returns `null` if the action's completion event
 * is explicitly null in the catalog. Returns `undefined` if the catalog file
 * does not exist on disk — callers treat this as "skip prompt attachment"
 * (the catalog will be populated incrementally; missing files must not break
 * success envelope routing). All other parse errors propagate.
 */
function resolveCompletionEvent(
  actionName: string,
  _template: PipelineTemplate,
): string | null | undefined {
  const root = resolveActionEventsRoot();
  const filename = `action.${actionName}.md`;
  const filePath = path.join(root, filename);
  if (!fs.existsSync(filePath)) return undefined;
  const text = fs.readFileSync(filePath, 'utf8');
  const parsed = parseActionEventFile(text, filename);
  if (parsed.kind !== 'action') {
    throw new Error(`Catalog file '${filePath}' parsed kind '${parsed.kind}' but action expected.`);
  }
  const fm = parsed.frontmatter as { kind: 'action'; completion_event: string | null };
  return fm.completion_event;
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
 * Attach `prompt` (composed catalog text) and `completion_event` (resolved
 * event name) to the engine's success envelope. Per FR-7 these fields live
 * inside `data` alongside `action` and `context` — they are NOT nested
 * inside `context`. Failure envelopes never reach this helper — they
 * construct their result inline with the `error: { ... }` field.
 *
 * Skips attachment entirely when the action's catalog file does not exist
 * on disk; the envelope still surfaces `action` and the enriched context so
 * downstream consumers that do not depend on the composed prompt continue
 * to operate (catalog population proceeds independently of pipeline routing).
 *
 * When the firing event is an orphan event with a non-empty custom-post
 * overlay, the orphan-post body is prepended under `## Step 1` via
 * `composeOrphanRuntimeShape`, and the downstream action's composed sections
 * renumber from `## Step 2` via `composeActionPrompt({ startStep: 2 })`.
 * The success envelope's `has_custom_instructions` flag reflects whether the
 * orphan-post overlay (or any downstream overlay) contributed content.
 */
export function attachPromptIfActionResolved(
  next: { action: string; context: Record<string, unknown> } | null,
  template: PipelineTemplate,
  firingEvent: string,
  projectDir: string,
): PipelineResult {
  if (!next) return { action: null, context: {} };
  next.context = resolveDocPaths(next.context, projectDir);
  const completion_event = resolveCompletionEvent(next.action, template);
  if (completion_event === undefined) {
    return { action: next.action, context: next.context };
  }
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
      });
      prompt = orphanShape.prompt.replace(NEXT_ACTION_PLACEHOLDER, downstream.prompt);
      has_custom_instructions = true; // orphan-post admitted, regardless of downstream overlay
    } else {
      const composed = composeActionPrompt({
        actionName: next.action,
        completionEvent: completion_event,
        catalogRoot,
      });
      prompt = composed.prompt;
      has_custom_instructions = composed.has_custom_instructions;
    }
  } else {
    const composed = composeActionPrompt({
      actionName: next.action,
      completionEvent: completion_event,
      catalogRoot,
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

    const wrappedReadDocument = (docPath: string) => {
      if (path.isAbsolute(docPath)) {
        return io.readDocument(docPath);
      }

      const resolvedProjectDir = path.resolve(projectDir);
      const resolved = path.resolve(resolvedProjectDir, docPath);
      const relativeToProject = path.relative(resolvedProjectDir, resolved);

      if (relativeToProject === '..' || relativeToProject.startsWith(`..${path.sep}`) || path.isAbsolute(relativeToProject)) {
        throw new Error(`Document path escapes project directory: ${docPath}`);
      }

      return io.readDocument(resolved);
    };

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
        );
      } else {
        const walkerResult = walkDAG(state, template, config, wrappedReadDocument);

        state.project.updated = new Date().toISOString();

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
      // Defensive guard: all 6 OUT_OF_BAND_EVENTS are unconditionally registered in mutations.ts,
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
      // advanced any newly-activated nodes. FR-8, AD-1.
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

    return attachPromptIfActionResolved(nextAction ?? null, template, event, projectDir);
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
