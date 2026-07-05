import { deriveArtifacts, type Artifact, type ArtifactKind } from './artifact-model';
import { getOrderedDocsV5 } from './document-ordering';
import type { OrderedDoc } from '@/types/components';
import type { ProjectStateV5, ProjectStateV6 } from '@/types/state';

/**
 * A single document the artifact-viewer modal can show, identified by its
 * project-relative path rather than a bare root filename. A root doc's `path`
 * is its bare filename — identical to `Artifact.fileName` and to the keys the
 * live store (`use-artifact-live.tsx`) already pulses/mtimes by — so root
 * pulsing keeps working unchanged. A subfolder doc's `path` is the full
 * relative path `getOrderedDocsV5` carries on `OrderedDoc.path` (e.g.
 * `"phases/PHASE-2-PLAN.md"`), which also matches the live store's keys since
 * both are sourced from the same recursive file listing.
 */
export interface ModalDoc {
  path: string;
  title: string;
  isMarkdown: boolean;
  kind: ArtifactKind;
  /** For future grouping; not load-bearing here. */
  category?: OrderedDoc['category'] | 'visual';
}

function artifactToModalDoc(a: Artifact): ModalDoc {
  return {
    path: a.fileName,
    title: a.title ?? a.label,
    isMarkdown: a.isMarkdown,
    kind: a.kind,
    // Every artifact-model doc that reaches this conversion with a category
    // already set is a pipeline doc sourced from the spine instead (filtered
    // out before this runs) — so the only categorization left to add here is
    // "visual" for the non-markdown docs the spine can never walk.
    category: a.isMarkdown ? undefined : 'visual',
  };
}

function orderedDocToModalDoc(d: OrderedDoc): ModalDoc {
  // getOrderedDocsV5 only ever walks .md doc_path values (planning/phase/task/
  // review docs and the tail's .md sweep), so every spine entry is markdown.
  return { path: d.path, title: d.title, isMarkdown: true, kind: 'markdown', category: d.category };
}

/**
 * Build the modal's unified, path-identified document list.
 *
 * Without a pipeline timeline there is no `getOrderedDocsV5` spine to walk, so
 * the list is exactly today's root-only `deriveArtifacts` order.
 *
 * With a timeline, `getOrderedDocsV5` is the ordering spine and is emitted
 * verbatim (planning → phase → task → review → error-log → other-root tail).
 * The only docs that spine never walks — root HTML visuals (brainstorm
 * visual, wireframes, any other root .html) and the brainstorm markdown — are
 * inserted into the front (planning/root) block, adjacent to the planning
 * docs. Error Log, Plan Audit, and generic other-root .md docs are NOT
 * hoisted; they stay wherever the spine's tail already puts them. A doc
 * inserted into the front block is removed from the spine's tail so it never
 * shows twice (the tail sweep has no denylist, so an unclaimed root .md like
 * the brainstorm doc would otherwise surface there too).
 */
export function buildModalDocs(
  projectName: string,
  files: string[],
  state: ProjectStateV5 | ProjectStateV6 | null,
  hasTimeline: boolean,
): ModalDoc[] {
  if (!hasTimeline || !state) {
    return deriveArtifacts(projectName, files, false).map(artifactToModalDoc);
  }

  const spine = getOrderedDocsV5(state, projectName, files);

  const brainstormingMd = `${projectName}-BRAINSTORMING.md`;
  const rootArtifacts = deriveArtifacts(projectName, files, true);
  const extras = rootArtifacts
    .filter((a) => !a.isMarkdown || a.fileName === brainstormingMd)
    .map(artifactToModalDoc);

  const extraPaths = new Set(extras.map((e) => e.path));
  const spineDocs = spine.filter((d) => !extraPaths.has(d.path));

  const frontEnd = spineDocs.findIndex((d) => d.category !== 'planning');
  const insertAt = frontEnd === -1 ? spineDocs.length : frontEnd;

  return [
    ...spineDocs.slice(0, insertAt).map(orderedDocToModalDoc),
    ...extras,
    ...spineDocs.slice(insertAt).map(orderedDocToModalDoc),
  ];
}
