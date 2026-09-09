import type { DeletionReport } from '@rad-orchestration/work-graph';

// Pure predicate, unit-testable directly against a hand-built DeletionReport
// fixture: the project directory's own item outcome, not the report's overall
// `complete` flag. A later item (e.g. graph-edges) can fail AFTER project-dir
// has already been physically removed, leaving `complete: false` even though
// the directory is gone — the old `report.complete && ...` guard missed this
// narrower case and left SSE clients showing a project that no longer exists.
// This is a strict superset of the old condition: it still fires whenever the
// report is fully complete with a removed item, since that always implies
// project-dir itself was removed.
//
// Lives outside route.ts: a Next.js App Router route file may only export the
// handful of recognized route fields (GET, POST, dynamic, etc.) — any other
// export fails the framework's route-shape typecheck at build time.
export function projectDirWasRemoved(report: DeletionReport): boolean {
  return report.items.some((item) => item.kind === 'project-dir' && item.outcome === 'removed');
}
