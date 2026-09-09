import os from 'node:os';
import path from 'node:path';

function radorchHome(): string {
  return path.join(os.homedir(), '.radorc');
}
export function getProjectsRoot(): string { return path.join(radorchHome(), 'projects'); }
export function getWorktreesRoot(): string { return path.join(radorchHome(), 'worktrees'); }
export function getSideProjectsRoot(): string { return path.join(radorchHome(), 'side-projects'); }
export function getRegistryRoot(): string { return radorchHome(); }
export function getTemplatesRoot(): string { return path.join(radorchHome(), 'templates'); }
export function getDocsRoot(): string { return path.join(radorchHome(), 'docs'); }
export function getOrchestrationYmlPath(): string { return path.join(radorchHome(), 'orchestration.yml'); }
export function resolveProjectDir(name: string): string { return path.join(getProjectsRoot(), name); }

export function getTelemetryRoot(): string { return process.env.RADORC_TELEMETRY_ROOT ?? path.join(radorchHome(), 'telemetry'); }

export function resolveDocPath(projectName: string, relativePath: string): string {
  const cleaned = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const prefix = projectName + '/';
  const stripped = cleaned.startsWith(prefix) ? cleaned.slice(prefix.length) : cleaned;
  return path.join(resolveProjectDir(projectName), stripped);
}

// Same containment idiom the work-graph library uses (lib/work-graph/src/delete-project.ts):
// a path.relative result that isn't empty, doesn't escape via '..', and isn't itself
// absolute (a Windows drive-letter mismatch yields an absolute "relative" path).
function isStrictlyUnderHome(rel: string): boolean {
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** Collapses the user's home directory to '~' for display. Returns `p`
 *  unchanged when it is not under the home directory. */
export function toHomeRelativePath(p: string): string {
  const home = os.homedir();
  const rel = path.relative(home, p);
  if (rel === '') return '~';
  if (!isStrictlyUnderHome(rel)) return p;
  return path.join('~', rel);
}

/** The same collapse applied to a path embedded in prose (e.g. a
 *  protectedReason sentence) — an occurrence replacement, not a path op. */
export function collapseHomeInText(text: string): string {
  const home = os.homedir();
  return text.split(home).join('~');
}
