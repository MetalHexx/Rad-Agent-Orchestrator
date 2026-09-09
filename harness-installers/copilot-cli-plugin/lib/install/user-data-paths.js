import os from 'node:os';
import path from 'node:path';

/** @param {{ radHome?: string }} [opts] */
export function userDataPaths(opts = {}) {
  const root = opts.radHome ?? path.join(os.homedir(), '.radorc');
  return {
    root,
    installJson: path.join(root, 'install.json'),
    orchestrationYml: path.join(root, 'orchestration.yml'),
    templates: path.join(root, 'templates'),
    docs: path.join(root, 'docs'),
    ui: path.join(root, 'ui'),
    projects: path.join(root, 'projects'),
    logs: path.join(root, 'logs'),
    installLog: path.join(root, 'logs', 'install.log'),
    uiPidFile: path.join(root, 'runtime', 'ui.pid'),
  };
}
