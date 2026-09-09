import os from 'node:os';
import path from 'node:path';

export interface UserDataPaths {
  readonly root: string;
  readonly installJson: string;
  readonly orchestrationYml: string;
  readonly ui: string;
  readonly templates: string;
  readonly projects: string;
  readonly sideProjects: string;
  readonly worktrees: string;
  readonly logs: string;
  readonly runtime: string;
  readonly telemetry: string;
  readonly bootstrapLock: string;
  readonly actionEvents: string;
  readonly communicationStyles: string;
}

export const SIDE_PROJECTS_DIRNAME = 'side-projects';

export function userDataPaths(): UserDataPaths {
  const root = path.join(os.homedir(), '.radorc');
  return {
    root,
    installJson: path.join(root, 'install.json'),
    orchestrationYml: path.join(root, 'orchestration.yml'),
    ui: path.join(root, 'ui'),
    templates: path.join(root, 'templates'),
    projects: path.join(root, 'projects'),
    sideProjects: path.join(root, SIDE_PROJECTS_DIRNAME),
    worktrees: path.join(root, 'worktrees'),
    logs: path.join(root, 'logs'),
    runtime: path.join(root, 'runtime'),
    telemetry: path.join(root, 'telemetry'),
    bootstrapLock: path.join(root, 'runtime', 'bootstrap.lock'),
    actionEvents: path.join(root, 'action-events'),
    communicationStyles: path.join(root, 'communication-styles'),
  };
}

export interface InstallPaths {
  readonly root: string;
  readonly installJson: string;
  readonly gitignore: string;
  readonly projectsDir: string;
  readonly worktreesDir: string;
  readonly logsDir: string;
  readonly cliLog: string;
  readonly harnessesDir: string;
  readonly runtimeDir: string;
  readonly uiPidFile: string;
  readonly uiLog: string;
}

export function resolveInstallRoot(): string {
  return path.join(os.homedir(), '.radorc');
}

export function installPaths(root: string): InstallPaths {
  const join = path.join;
  return {
    root,
    installJson: join(root, 'install.json'),
    gitignore: join(root, '.gitignore'),
    projectsDir: join(root, 'projects'),
    worktreesDir: join(root, 'worktrees'),
    logsDir: join(root, 'logs'),
    cliLog: join(root, 'logs', 'cli.log'),
    harnessesDir: join(root, 'runtime', 'harnesses'),
    runtimeDir: join(root, 'runtime'),
    uiPidFile: join(root, 'runtime', 'ui.pid'),
    uiLog: join(root, 'logs', 'ui.log'),
  };
}
