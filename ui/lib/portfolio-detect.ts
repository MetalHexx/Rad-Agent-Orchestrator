import { WorkGraphService } from '@rad-orchestration/work-graph';
import { getRegistryRoot, getProjectsRoot } from './path-resolver';
import { portfolioShow, workGraphAdapter, defaultFsReads } from './portfolio-show';

/** A project's resolved portfolio membership. */
export interface DetectedPortfolio {
  name: string; // portfolio base name, e.g. 'PORTFOLIO'
  rootDir: string; // absolute path to {BASE}-ROOT
  iterationDir: string; // absolute path to this project's own document folder
}

/**
 * Resolves the portfolio a project belongs to by reading the work graph and the
 * project documents in process, or null for non-membership.
 *
 * Never throws. Two failure surfaces sit under the single catch below and both
 * collapse to null exactly like genuine non-membership: composing the graph,
 * which throws on an unreadable registry, and `portfolioShow`, which throws
 * "no portfolio named X" when the containing group is not a portfolio. Callers
 * must not be able to tell failure from non-membership — neither may affect the
 * result of an approval, and `debrief/launch` has no guard of its own at all.
 * What this does NOT guard is a caller-visible defect in its own return shape;
 * callers that cannot tolerate that residual risk (the gate route) guard the
 * call locally rather than trusting this contract outright.
 *
 * Stays `async` so the existing `await detectPortfolio(name)` call sites need
 * no edit; nothing inside it awaits I/O.
 */
export async function detectPortfolio(projectName: string): Promise<DetectedPortfolio | null> {
  try {
    // Composing the graph derives every project's `worktrees` field via `resolveWorktrees`,
    // which shells out to `git worktree list --porcelain` per repo binding when `exec` is
    // left unset — the same reason ui/app/api/work-graph/route.ts passes a throwing `exec`.
    // This helper reads neither `worktrees` nor `tier`; without the override a single
    // detectPortfolio call can spawn one `git` subprocess per repo-bound project in the
    // WHOLE registry — trading one subprocess cost for a much worse one.
    const root = getRegistryRoot();
    const svc = new WorkGraphService({
      root,
      exec: () => { throw new Error('worktree resolution disabled'); },
    });
    const port = workGraphAdapter({ root, service: svc });

    // `port.getGraph()` composes once and caches inside `port` (see workGraphAdapter's
    // `cached` variable) — `portfolioShow` below reads through this SAME `port`, so its
    // own `listGroups`/`listMembers`/`getGraph` calls hit that cache instead of recomposing.
    const group = port.getGraph().edges
      .find((e) => e.type === 'contains' && e.to === projectName)?.from
      ?.replace(/^group:/, '');
    if (!group) return null;

    const result = portfolioShow({
      projectsDir: getProjectsRoot(),
      portfolio: group,
      port,
      fs: defaultFsReads(),
    });

    const iteration = result.iterations.find((it) => it.name === projectName);
    if (!iteration) return null;
    return { name: result.name, rootDir: result.root.dir, iterationDir: iteration.dir };
  } catch {
    return null;
  }
}
