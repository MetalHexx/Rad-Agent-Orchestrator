// harness-installers/standard/lib/install/user-data-paths.js —
// Returns the canonical user-data paths under ~/.radorc/. The standard
// installer never creates `runtime/` (the dashboard creates it lazily — FR-2)
// and ships no `config.yml`, `registry.yml`, or `.harness` pointer (AD-1).

import os from 'node:os';
import path from 'node:path';

/**
 * @param {{ home?: string }} [opts]
 * @returns {{
 *   root: string,
 *   installJson: string,
 *   orchestrationYml: string,
 *   ui: string,
 *   templates: string,
 *   projects: string,
 *   telemetry: string,
 *   logs: string,
 *   actionEvents: string,
 * }}
 */
export function userDataPaths(opts = {}) {
  const home = opts.home ?? os.homedir();
  const root = path.join(home, '.radorc');
  return {
    root,
    installJson: path.join(root, 'install.json'),
    orchestrationYml: path.join(root, 'orchestration.yml'),
    ui: path.join(root, 'ui'),
    templates: path.join(root, 'templates'),
    projects: path.join(root, 'projects'),
    telemetry: path.join(root, 'telemetry'),
    logs: path.join(root, 'logs'),
    actionEvents: path.join(root, 'action-events'),
    uiPidFile: path.join(root, 'runtime', 'ui.pid'),
  };
}
