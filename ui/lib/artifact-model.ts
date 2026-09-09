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
  /** True for Requirements / Master Plan when a pipeline timeline exists — they pin to the top in fixed order ahead of the alpha-sorted rest. */
  pinned?: boolean;
  /** Discriminator for the pipeline-doc identity of this artifact; absent for brainstorm/wireframe/generic docs. */
  category?: 'requirements' | 'master-plan' | 'error-log' | 'plan-audit' | 'amendment' | 'other';
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
 * pipeline timeline. When a timeline DOES exist, `deriveArtifacts` surfaces all
 * four pipeline docs too — Requirements and Master Plan pinned first (in that
 * order), Plan Audit and Error Log sorted into the normal group — since the DAG
 * timeline no longer renders Requirements on its own, this list becomes the
 * single home for the whole set. See the `hasTimeline` branch below.
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

const PIPELINE_DOC_META: Record<(typeof PIPELINE_DOC_SUFFIXES)[number], { label: string; category: NonNullable<Artifact['category']> }> = {
  '-REQUIREMENTS.md': { label: 'Requirements', category: 'requirements' },
  '-MASTER-PLAN.md': { label: 'Master Plan', category: 'master-plan' },
  '-PLAN-AUDIT.md': { label: 'Plan Audit', category: 'plan-audit' },
  '-ERROR-LOG.md': { label: 'Error Log', category: 'error-log' },
};

/** Resolve the honest label/category for a root pipeline doc, or null when `fileName` isn't one. */
function pipelineDocMeta(fileName: string, project: string): { label: string; category: NonNullable<Artifact['category']> } | null {
  const suffix = PIPELINE_DOC_SUFFIXES.find((s) => fileName === `${project}${s}`);
  return suffix ? PIPELINE_DOC_META[suffix] : null;
}

/** Neutralize regex metacharacters so an interpolated value matches literally. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Resolve the label/category for a root amendment doc, or null when `fileName`
 * isn't one. Amendment docs are named `${project}-AMENDMENT-{NN}.md`, one per
 * amendment — an indexed family, not a single fixed name, so they can't be
 * matched by `PIPELINE_DOC_SUFFIXES`'s exact-suffix denylist. Recognized by
 * prefix instead, independent of `hasTimeline`.
 */
function amendmentDocMeta(fileName: string, project: string): { label: string; category: 'amendment' } | null {
  const match = new RegExp(`^${escapeRegExp(project)}-AMENDMENT-(\\d+)\\.md$`).exec(fileName);
  if (!match) return null;
  return { label: `Amendment ${parseInt(match[1], 10)}`, category: 'amendment' };
}

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
   * True when the project has a pipeline timeline (a parsed v5/v6 state).
   * When true, Requirements and Master Plan pin to the top of the returned
   * list (in that order) and Plan Audit / Error Log surface in the normal
   * group — the DAG timeline no longer renders these on its own, so this
   * list becomes their single home. When false (stateless projects with no
   * DAG), behavior is unchanged from before this flag existed: Requirements
   * surfaces as a first-class doc and the other three pipeline docs stay
   * hidden via the denylist.
   */
  hasTimeline = false,
): Artifact[] {
  const brainstormingMd = `${project}-BRAINSTORMING.md`;
  const brainstormVisual = `${project}-BRAINSTORM.html`;
  const requirementsMd = `${project}-REQUIREMENTS.md`;
  const masterPlanMd = `${project}-MASTER-PLAN.md`;
  const wireframeRe = new RegExp(`^${escapeRegExp(project)}-WIREFRAME-(.+)\\.html$`);

  const root = files.filter(isRootFile);
  const out: Artifact[] = [];
  const pinned: Artifact[] = [];

  if (root.includes(brainstormingMd)) {
    out.push({ fileName: brainstormingMd, kind: 'markdown', label: 'Brainstorm', title: null, isMarkdown: true });
  }

  if (hasTimeline) {
    // Requirements then Master Plan pin to the top, in that fixed order,
    // ahead of the alpha-sorted rest of the list.
    if (root.includes(requirementsMd)) {
      pinned.push({ fileName: requirementsMd, kind: 'markdown', label: 'Requirements', title: null, isMarkdown: true, pinned: true, category: 'requirements' });
    }
    if (root.includes(masterPlanMd)) {
      pinned.push({ fileName: masterPlanMd, kind: 'markdown', label: 'Master Plan', title: null, isMarkdown: true, pinned: true, category: 'master-plan' });
    }
  } else if (root.includes(requirementsMd)) {
    // REQUIREMENTS surfaces as a first-class doc ONLY when the project has no
    // pipeline timeline; pipelined projects pin it above instead (don't
    // duplicate it here). It stays in PIPELINE_DOC_SUFFIXES so it never leaks
    // into the generic "other docs" path regardless of this flag.
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

  // "Other docs" group: every remaining root .html and .md. Without a
  // timeline, .md is still filtered by the pipeline denylist (today's
  // behavior, unchanged). With a timeline, Requirements/Master Plan are
  // already captured above (pinned), so the denylist is skipped here —
  // that's what lets Plan Audit / Error Log fall through into this group.
  // Final ordering for all groups is applied once at the end.
  const captured = new Set([...pinned, ...out].map((a) => a.fileName));
  const otherDocs = root
    .filter((f) => !captured.has(f))
    .filter((f) => {
      if (f.endsWith('.html')) return true;
      if (f.endsWith('.md')) return hasTimeline || !isPipelineDoc(f, project);
      return false;
    })
    .map((f): Artifact => {
      if (f.endsWith('.md')) {
        const amendmentMeta = amendmentDocMeta(f, project);
        if (amendmentMeta) {
          return { fileName: f, kind: 'markdown', label: amendmentMeta.label, title: null, isMarkdown: true, category: amendmentMeta.category };
        }
        const meta = hasTimeline ? pipelineDocMeta(f, project) : null;
        if (meta) {
          return { fileName: f, kind: 'markdown', label: meta.label, title: null, isMarkdown: true, category: meta.category };
        }
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

  return [...pinned, ...out];
}
