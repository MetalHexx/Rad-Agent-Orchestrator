import { PLANNING_STEP_ORDER, NODE_ID_FINAL_REVIEW } from '@/types/state';
import type { PlanningStepName, ProjectStateV5, ProjectStateV6 } from '@/types/state';
import type { OrderedDoc } from '@/types/components';

function tailDocLabelV5(filename: string, projectName: string): string {
  // FR-12 — drop the trailing `.md`, strip the leading `{projectName}-`
  // prefix (case-insensitive), convert remaining `-`/`_` separators to
  // spaces, and title-case the result. Bare filenames with no prefix
  // pass through to the title-case step unchanged.
  let stem = filename.replace(/\.md$/i, '');
  const prefix = `${projectName}-`;
  if (stem.toLowerCase().startsWith(prefix.toLowerCase())) {
    stem = stem.slice(prefix.length);
  }
  const words = stem.split(/[-_\s]+/).filter((w) => w.length > 0);
  return words
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

// Tail-bucket emitter for v5/v6 walks.
function appendAllFileDocsV5(
  allFiles: string[],
  projectName: string,
  seenPaths: Set<string>,
  seenBasenames: Set<string>,
  basename: (p: string) => string,
  push: (path: string, title: string, category: OrderedDoc['category']) => void,
): void {
  // FR-11 — error log label and detection unchanged.
  const errorLogPattern = `${projectName}-ERROR-LOG.md`;
  const errorLogFile = allFiles.find((f) => f.endsWith(errorLogPattern));
  if (errorLogFile && !seenPaths.has(errorLogFile)) {
    push(errorLogFile, 'Error Log', 'error-log');
  }

  const otherDocs = allFiles
    .filter((f) => /\.md$/i.test(f) && !seenBasenames.has(basename(f)))
    .sort();

  for (const filePath of otherDocs) {
    const filename = basename(filePath);
    push(filePath, tailDocLabelV5(filename, projectName), 'other');
  }
}

/**
 * Find the previous and next documents relative to the current path.
 */
export function getAdjacentDocs(
  docs: OrderedDoc[],
  currentPath: string,
): { prev: OrderedDoc | null; next: OrderedDoc | null; currentIndex: number; total: number } {
  const currentIndex = docs.findIndex((d) => d.path === currentPath);

  if (currentIndex === -1) {
    return { prev: null, next: null, currentIndex: -1, total: docs.length };
  }

  const prev = currentIndex > 0 ? docs[currentIndex - 1] : null;
  const next = currentIndex < docs.length - 1 ? docs[currentIndex + 1] : null;

  return { prev, next, currentIndex, total: docs.length };
}

// ─── v5 helpers ──────────────────────────────────────────────────────────────

// Within-iteration child emission order — locked per AD-3 / FR-5 so the walk
// is stable across engine refactors that rebuild iteration.nodes from a
// different seed. The phase-plan-from-iteration-doc_path step is emitted
// BEFORE this loop runs, so `phase_planning` is left in here as harmless
// forward-compat: a future template that wires it back as a child step node
// would still surface in the right slot. Same logic for `task_handoff` in
// TASK_ITER_CHILD_ORDER.
export const PHASE_ITER_CHILD_ORDER = ['phase_planning', 'task_loop', 'phase_report', 'phase_review'] as const;
export const TASK_ITER_CHILD_ORDER = ['task_handoff', 'code_review'] as const;

export const STEP_TITLES_V5: Record<PlanningStepName, string> = {
  research: 'Research Findings',
  prd: 'PRD',
  design: 'Design',
  architecture: 'Architecture',
  requirements: 'Requirements',
  master_plan: 'Master Plan',
  explode_master_plan: 'Phase/Task Generation',
};

function capitalize(s: string): string {
  return s.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export function titleForPhaseChild(childId: string, phaseNum: number): string {
  // phase_planning is v5 canonical; phase_plan retained for legacy compat.
  // Both IDs survive in the helper even though the default template now
  // sources the phase plan from iteration.doc_path (AD-2): a future custom
  // template scaffolding either ID as a child step node still surfaces with
  // the right label.
  if (childId === 'phase_planning' || childId === 'phase_plan') return `Phase ${phaseNum} Plan`;
  // AD-6 — phase_report mapping preserved as harmless dead code so that any
  // future template wiring it in surfaces with the correct label.
  if (childId === 'phase_report') return `Phase ${phaseNum} Report`;
  if (childId === 'phase_review') return `Phase ${phaseNum} Review`;
  // AD-1 — unrecognized child IDs surface with a generic per-scope label so
  // a future custom-template node never silently vanishes into the tail bucket.
  return `Phase ${phaseNum} ${capitalize(childId)}`;
}

export function titleForTaskChild(taskNodeId: string, phaseNum: number, taskNum: number): string {
  if (taskNodeId === 'task_handoff') return `P${phaseNum}-T${taskNum} Handoff`;
  if (taskNodeId === 'code_review') return `P${phaseNum}-T${taskNum} Review`;
  // AD-1 — generic fallback per scope.
  return `P${phaseNum}-T${taskNum} ${capitalize(taskNodeId)}`;
}

// FR-9 — task-scope corrective labels. `CT{K}` already implies a corrective
// handoff, so the plan label drops the "Handoff" word; the review label
// appends "Review" to keep the original-vs-corrective parallel symmetric.
export function titleForTaskCorrectiveChild(taskNodeId: string, phaseNum: number, taskNum: number, ctIndex: number): string {
  if (taskNodeId === 'task_handoff') return `P${phaseNum}-T${taskNum} CT${ctIndex}`;
  if (taskNodeId === 'code_review') return `P${phaseNum}-T${taskNum} CT${ctIndex} Review`;
  return `P${phaseNum}-T${taskNum} CT${ctIndex} ${capitalize(taskNodeId)}`;
}

// FR-10 — phase-scope correctives scaffold the same body-def node IDs as
// task-scope iterations (`task_handoff`, `code_review`). At phase scope
// `task_handoff` means "the corrective plan" and `code_review` means
// "its review." The label uses `Phase {N} CT{K}` shorthand to parallel the
// task-scope CT scheme.
export function titleForPhaseCorrectiveChild(childId: string, phaseNum: number, ctIndex: number): string {
  if (childId === 'task_handoff') return `Phase ${phaseNum} CT${ctIndex}`;
  if (childId === 'code_review') return `Phase ${phaseNum} CT${ctIndex} Review`;
  return `Phase ${phaseNum} CT${ctIndex} ${capitalize(childId)}`;
}

// Final-review-scope correctives mirror the phase-corrective structure.
// A final corrective has no handoff doc (ct.doc_path is null), so emit nothing
// for it. Its child `code_review` node's `doc_path` is the final review report
// re-opened in place — the same path already emitted for `final_review`.
// The seenPaths dedup guard collapses it to a single tile.
export function titleForFinalCorrectiveChild(childId: string, ctIndex: number): string {
  if (childId === 'code_review') return `Final CT${ctIndex} Review`;
  return `Final CT${ctIndex} ${capitalize(childId)}`;
}

/**
 * Derive the canonical document navigation order from a v5 or v6 project state.
 * Recursively walks graph.nodes, iteration entries, and corrective task entries
 * to collect doc_path values from step nodes.
 *
 * v6 state is structurally identical to v5; the node-walk is $schema-agnostic.
 *
 * Order: root step nodes → per-phase-iteration (phase step nodes → per-task-iteration
 *        (task step nodes → corrective task step nodes)) → final_review step → error log → other docs.
 */
export function getOrderedDocsV5(
  state: ProjectStateV5 | ProjectStateV6,
  projectName: string,
  allFiles?: string[],
): OrderedDoc[] {
  const result: OrderedDoc[] = [];
  const seenPaths = new Set<string>();
  const seenBasenames = new Set<string>();
  const basename = (p: string) => p.split(/[\/\\]/).pop() ?? p;

  const push = (path: string, title: string, category: OrderedDoc['category']) => {
    // Path is the modal's document identity (see ModalDoc). A corrective task's
    // doc_path is deliberately the SAME, unchanged handoff/plan doc as its
    // hosting iteration (see buildCorrectiveBirth's scopeDocPath — "never
    // re-authored"), so without this guard every corrective cycle would emit a
    // second filmstrip tile aliasing a doc already shown under its original
    // title, and both tiles would highlight together since the filmstrip's
    // active check is path-based.
    if (seenPaths.has(path)) return;
    result.push({ path, title, category });
    seenPaths.add(path);
    seenBasenames.add(basename(path));
  };

  // Emit planning steps in canonical order regardless of object key order.
  // Requirements is authored pre-pipeline (no state node since
  // PLANNING-OVERHAUL-1): work-graph `scanDocs`
  // (lib/work-graph/src/derive/projects.ts) is the canonical source of the
  // `${project}-REQUIREMENTS.md` convention this fallback mirrors.
  for (const planId of PLANNING_STEP_ORDER) {
    const node = state.graph.nodes[planId];
    if (node && node.kind === 'step' && node.doc_path != null) {
      push(node.doc_path, STEP_TITLES_V5[planId], 'planning');
    } else if (planId === 'requirements' && allFiles) {
      // Dedup guards against a legacy state that still carries the node.
      const reqFile = allFiles.find(
        (f) => basename(f) === `${projectName}-REQUIREMENTS.md`,
      );
      if (reqFile && !seenBasenames.has(basename(reqFile))) {
        push(reqFile, STEP_TITLES_V5.requirements, 'planning');
      }
    }
  }

  for (const [, node] of Object.entries(state.graph.nodes)) {
    // Skip all root step nodes (planning steps already emitted above; final_review emitted after loop)
    if (node.kind === 'step') {
      continue;
    }
    if (node.kind === 'for_each_phase') {
      const sortedIterations = [...node.iterations].sort((a, b) => a.index - b.index);
      for (const iteration of sortedIterations) {
        const phaseNum = iteration.index + 1;

        // FR-1 / AD-2 — phase plan from iteration.doc_path, emitted at the
        // start of the iteration's slice (before the iteration's child nodes).
        if (iteration.doc_path != null) {
          push(iteration.doc_path, `Phase ${phaseNum} Plan`, 'phase');
        }

        // FR-5 / AD-3 — explicit per-scope ordering. We iterate the locked
        // child-id list rather than Object.entries(iteration.nodes) so the
        // emitted sequence is stable across engine refactors that rebuild
        // the nodes map from a different seed. Unknown child IDs (custom
        // templates) are appended after the locked ones in insertion order
        // so they still surface (AD-1).
        // FR-1 / AD-2 dedup guard — when iteration.doc_path provided the phase
        // plan, skip any legacy `phase_planning` / `phase_plan` child step in the
        // same iteration so a hybrid persisted state doesn't surface the plan twice.
        const skipLegacyPhasePlanChild = iteration.doc_path != null;
        const isLegacyPhasePlanChild = (id: string): boolean =>
          skipLegacyPhasePlanChild && (id === 'phase_planning' || id === 'phase_plan');
        const phaseChildIds = [
          ...PHASE_ITER_CHILD_ORDER.filter((id) => id in iteration.nodes && !isLegacyPhasePlanChild(id)),
          ...Object.keys(iteration.nodes).filter(
            (id) => !(PHASE_ITER_CHILD_ORDER as readonly string[]).includes(id) && !isLegacyPhasePlanChild(id),
          ),
        ];

        for (const childId of phaseChildIds) {
          const child = iteration.nodes[childId];
          if (!child) continue;
          if (child.kind === 'step' && child.doc_path != null) {
            const category: OrderedDoc['category'] = childId.includes('review') ? 'review' : 'phase';
            push(child.doc_path, titleForPhaseChild(childId, phaseNum), category);
          } else if (child.kind === 'for_each_task') {
            const sortedTaskIters = [...child.iterations].sort((a, b) => a.index - b.index);
            for (const taskIter of sortedTaskIters) {
              const taskNum = taskIter.index + 1;

              // FR-2 / AD-2 — task handoff from taskIter.doc_path, emitted
              // before the task iteration's child nodes (i.e. before code_review).
              if (taskIter.doc_path != null) {
                push(taskIter.doc_path, `P${phaseNum}-T${taskNum} Handoff`, 'task');
              }

              // FR-2 / AD-2 dedup guard — when taskIter.doc_path provided the
              // handoff, skip a legacy `task_handoff` child step so a hybrid
              // persisted state doesn't surface the handoff twice.
              const skipLegacyTaskHandoffChild = taskIter.doc_path != null;
              const taskChildIds = [
                ...TASK_ITER_CHILD_ORDER.filter(
                  (id) => id in taskIter.nodes && !(skipLegacyTaskHandoffChild && id === 'task_handoff'),
                ),
                ...Object.keys(taskIter.nodes).filter(
                  (id) =>
                    !(TASK_ITER_CHILD_ORDER as readonly string[]).includes(id) &&
                    !(skipLegacyTaskHandoffChild && id === 'task_handoff'),
                ),
              ];

              for (const taskNodeId of taskChildIds) {
                const taskNode = taskIter.nodes[taskNodeId];
                if (!taskNode) continue;
                if (taskNode.kind === 'step' && taskNode.doc_path != null) {
                  const category: OrderedDoc['category'] = taskNodeId.includes('review') ? 'review' : 'task';
                  push(taskNode.doc_path, titleForTaskChild(taskNodeId, phaseNum, taskNum), category);
                }
              }

              // Task-scope correctives (FR-3 / AD-2) — corrective handoff
              // from ct.doc_path (NOT from ct.nodes.task_handoff). The
              // ct.nodes map for correctives only ever contains `code_review`
              // as a meaningful step node.
              const sortedCTs = [...taskIter.corrective_tasks].sort((a, b) => a.index - b.index);
              for (const ct of sortedCTs) {
                // FR-3 / AD-2 — corrective handoff from ct.doc_path.
                if (ct.doc_path != null) {
                  push(ct.doc_path, titleForTaskCorrectiveChild('task_handoff', phaseNum, taskNum, ct.index), 'task');
                }
                // FR-3 — corrective code review IS a child step node.
                const ctReview = ct.nodes['code_review'];
                if (ctReview?.kind === 'step' && ctReview.doc_path != null) {
                  push(ctReview.doc_path, titleForTaskCorrectiveChild('code_review', phaseNum, taskNum, ct.index), 'review');
                }
                // AD-1 — surface any other unrecognized child step node so
                // custom templates do not silently leak to the tail bucket.
                for (const [otherId, otherNode] of Object.entries(ct.nodes)) {
                  if (otherId === 'code_review') continue;
                  if (otherNode.kind === 'step' && otherNode.doc_path != null) {
                    push(otherNode.doc_path, titleForTaskCorrectiveChild(otherId, phaseNum, taskNum, ct.index), 'task');
                  }
                }
              }
            }
          }
        }

        // Phase-scope correctives (FR-3 / AD-2) — corrective handoff from
        // ct.doc_path; corrective code review from ct.nodes.code_review.
        const sortedPhaseCTs = [...iteration.corrective_tasks].sort((a, b) => a.index - b.index);
        for (const ct of sortedPhaseCTs) {
          if (ct.doc_path != null) {
            push(ct.doc_path, titleForPhaseCorrectiveChild('task_handoff', phaseNum, ct.index), 'phase');
          }
          const ctReview = ct.nodes['code_review'];
          if (ctReview?.kind === 'step' && ctReview.doc_path != null) {
            push(ctReview.doc_path, titleForPhaseCorrectiveChild('code_review', phaseNum, ct.index), 'review');
          }
          for (const [otherId, otherNode] of Object.entries(ct.nodes)) {
            if (otherId === 'code_review') continue;
            if (otherNode.kind === 'step' && otherNode.doc_path != null) {
              push(otherNode.doc_path, titleForPhaseCorrectiveChild(otherId, phaseNum, ct.index), 'phase');
            }
          }
        }
      }
    }
    // gate, conditional, parallel, for_each_task: skip
  }

  // Emit final_review and any other top-level step nodes with corrective tasks.
  // Step nodes were skipped in the main loop above, so emit them here after phase/task iterations.
  // The seenPaths dedup guard already handles the final corrective child's code_review which
  // aliases final_review's doc_path — it will surface only once.
  const planningStepIds = new Set(PLANNING_STEP_ORDER);
  for (const [stepId, stepNode] of Object.entries(state.graph.nodes)) {
    if (stepNode.kind !== 'step' || planningStepIds.has(stepId as PlanningStepName)) {
      continue;
    }
    // Emit the step node's own doc
    if (stepNode.doc_path != null) {
      const category: OrderedDoc['category'] = stepId === NODE_ID_FINAL_REVIEW ? 'review' : 'other';
      const title = stepId === NODE_ID_FINAL_REVIEW ? 'Final Review' : capitalize(stepId);
      push(stepNode.doc_path, title, category);
    }
    // Emit corrective task child step docs if present
    if (stepNode.corrective_tasks) {
      const sortedCTs = [...stepNode.corrective_tasks].sort((a, b) => a.index - b.index);
      for (const ct of sortedCTs) {
        // Final correctives have no handoff doc (ct.doc_path is null by design).
        // Their child code_review node's doc_path is the final review report re-opened —
        // the same path already emitted, so seenPaths dedup is correct.
        for (const [ctChildId, ctNode] of Object.entries(ct.nodes)) {
          if (ctNode.kind === 'step' && ctNode.doc_path != null) {
            const ctTitle = stepId === NODE_ID_FINAL_REVIEW
              ? titleForFinalCorrectiveChild(ctChildId, ct.index)
              : `${capitalize(stepId)} CT${ct.index} ${capitalize(ctChildId)}`;
            const ctCategory: OrderedDoc['category'] = ctChildId.includes('review') ? 'review' : 'other';
            push(ctNode.doc_path, ctTitle, ctCategory);
          }
        }
      }
    }
  }

  if (allFiles) {
    appendAllFileDocsV5(allFiles, projectName, seenPaths, seenBasenames, basename, push);
  }

  return result;
}
