export type ArtifactKind = 'markdown' | 'visual' | 'wireframe' | 'html';

export interface Artifact {
  /** Project-root filename, e.g. "DEMO-WIREFRAME-LAUNCH-SCREEN.html". */
  fileName: string;
  kind: ArtifactKind;
  /** Locked type label per FR-3. */
  label: string;
  /** Humanized title (wireframes only); null otherwise. */
  title: string | null;
  /** True for .md (renders via markdown renderer), false for .html (iframe). */
  isMarkdown: boolean;
}

/**
 * Planner/pipeline-generated root docs that must NOT surface as generic artifacts.
 *
 * Markdown selection is a DENYLIST: every root `.md` is surfaced as a generic
 * doc EXCEPT files whose name ends with one of these `${project}-…` suffixes.
 * These are pipeline outputs (requirements, the master plan, the plan audit,
 * the error log) — audit-trail docs, not brainstorming artifacts. Extend this
 * list to hide additional pipeline-generated root docs.
 *
 * REQUIREMENTS is a special case: it stays on this denylist (so it never leaks
 * into the generic "other docs" path), but `deriveArtifacts` surfaces it as a
 * first-class doc with a locked "Requirements" label when the project has NO
 * pipeline timeline. Pipelined projects render it in the DAG timeline instead,
 * so surfacing it here too would duplicate it — see the `hasTimeline` gate below.
 *
 * Note: tasks/phases/reports stay out via the root-only filter (they live in
 * subfolders), so they are intentionally absent here.
 */
export const PIPELINE_DOC_SUFFIXES = [
  '-REQUIREMENTS.md',
  '-MASTER-PLAN.md',
  '-PLAN-AUDIT.md',
  '-ERROR-LOG.md',
] as const;

function isRootFile(relPath: string): boolean {
  return !relPath.includes('/');
}

function humanizeSlug(slug: string): string {
  return slug
    .split('-')
    .map((w) => (w.length === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ');
}

/** Strip the leading `${project}-` prefix and the given extension (.html/.md). */
function stripProjectPrefix(fileName: string, project: string, ext: RegExp): string {
  const base = fileName.replace(ext, '');
  const prefix = `${project}-`;
  return base.startsWith(prefix) ? base.slice(prefix.length) : base;
}

function isPipelineDoc(fileName: string, project: string): boolean {
  return PIPELINE_DOC_SUFFIXES.some((suffix) => fileName === `${project}${suffix}`);
}

export function deriveArtifacts(
  project: string,
  files: string[],
  /**
   * True when the project has a pipeline timeline (a parsed v5/v6 state). The
   * requirements doc is rendered in the DAG timeline for those projects, so it
   * is suppressed here to avoid showing it twice. Stateless projects (no DAG)
   * surface it in this list as their only home for the doc.
   */
  hasTimeline = false,
): Artifact[] {
  const brainstormingMd = `${project}-BRAINSTORMING.md`;
  const brainstormVisual = `${project}-BRAINSTORM.html`;
  const requirementsMd = `${project}-REQUIREMENTS.md`;
  const wireframeRe = new RegExp(`^${project}-WIREFRAME-(.+)\\.html$`);

  const root = files.filter(isRootFile);
  const out: Artifact[] = [];

  if (root.includes(brainstormingMd)) {
    out.push({ fileName: brainstormingMd, kind: 'markdown', label: 'Brainstorm', title: null, isMarkdown: true });
  }
  // REQUIREMENTS surfaces as a first-class doc ONLY when the project has no
  // pipeline timeline; pipelined projects render it in the DAG timeline (don't
  // duplicate it here). It stays in PIPELINE_DOC_SUFFIXES so it never leaks into
  // the generic "other docs" path regardless of this flag.
  if (!hasTimeline && root.includes(requirementsMd)) {
    out.push({ fileName: requirementsMd, kind: 'markdown', label: 'Requirements', title: null, isMarkdown: true });
  }
  if (root.includes(brainstormVisual)) {
    out.push({ fileName: brainstormVisual, kind: 'visual', label: 'Brainstorm Visual', title: null, isMarkdown: false });
  }

  const wireframes = root
    .map((f) => ({ f, m: wireframeRe.exec(f) }))
    .filter((x): x is { f: string; m: RegExpExecArray } => x.m !== null)
    .map(({ f, m }) => ({
      fileName: f,
      kind: 'wireframe' as const,
      label: 'Wireframe',
      title: humanizeSlug(m[1]),
      isMarkdown: false,
    }));
  out.push(...wireframes);

  // "Other docs" group: every remaining root .html and .md, EXCEPT the pipeline
  // denylist (.md). Final ordering for all groups is applied once at the end.
  const captured = new Set(out.map((a) => a.fileName));
  const otherDocs = root
    .filter((f) => !captured.has(f))
    .filter((f) => {
      if (f.endsWith('.html')) return true;
      if (f.endsWith('.md')) return !isPipelineDoc(f, project);
      return false;
    })
    .map((f): Artifact => {
      if (f.endsWith('.md')) {
        const slug = stripProjectPrefix(f, project, /\.md$/i);
        return {
          fileName: f,
          kind: 'markdown',
          label: 'Doc',
          title: slug ? humanizeSlug(slug) : null,
          isMarkdown: true,
        };
      }
      const slug = stripProjectPrefix(f, project, /\.html$/i);
      return {
        fileName: f,
        kind: 'html',
        label: 'Visual',
        title: slug ? humanizeSlug(slug) : null,
        isMarkdown: false,
      };
    });
  out.push(...otherDocs);

  // Stable ordering for every surface that renders this list (DAG rows, launch
  // tiles, modal filmstrip): markdown first, then html, alphabetical by filename
  // within each type. Deliberately NOT mtime-based — a live edit bumps a file's
  // mtime, and an mtime sort would reorder rows on every change (and shift the
  // modal's active item). Type+name is stable across edits.
  out.sort((a, b) => {
    if (a.isMarkdown !== b.isMarkdown) return a.isMarkdown ? -1 : 1;
    return a.fileName.localeCompare(b.fileName);
  });

  return out;
}
