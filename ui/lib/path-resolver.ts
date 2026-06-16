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
export function getOrchestrationYmlPath(): string { return path.join(radorchHome(), 'orchestration.yml'); }
export function resolveProjectDir(name: string): string { return path.join(getProjectsRoot(), name); }

export function resolveDocPath(projectName: string, relativePath: string): string {
  const cleaned = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const prefix = projectName + '/';
  const stripped = cleaned.startsWith(prefix) ? cleaned.slice(prefix.length) : cleaned;
  return path.join(resolveProjectDir(projectName), stripped);
}
