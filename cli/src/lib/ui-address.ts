/**
 * The one home for "where is the dashboard, and what is the URL of a project
 * document". `ui start` resolves its listen port here; `amendment validate`
 * resolves the same port to build a document link — one shared config read,
 * two callers.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseYaml } from './yaml.js';

export const DEFAULT_UI_PORT = 1337;

interface OrchestrationUiConfig {
  ui?: { port?: unknown };
}

/**
 * Reads `ui.port` from `<root>/orchestration.yml` — the deployed copy under
 * `~/.radorc/`, never the repo's `runtime-config/orchestration.yml` install-time
 * seed. An absent file, unparseable YAML, a missing `ui.port`, or a
 * non-integer / out-of-range (1-65535) value all degrade to `DEFAULT_UI_PORT`.
 * Must never throw — `ui start` depends on that, and a throw here would take
 * the dashboard down on bad config.
 */
export function resolveUiPort(root: string): number {
  const configPath = path.join(root, 'orchestration.yml');
  if (!fs.existsSync(configPath)) return DEFAULT_UI_PORT;
  try {
    const parsed = parseYaml<OrchestrationUiConfig>(fs.readFileSync(configPath, 'utf8'));
    const port = parsed?.ui?.port;
    if (typeof port === 'number' && Number.isInteger(port) && port >= 1 && port <= 65535) {
      return port;
    }
    return DEFAULT_UI_PORT;
  } catch {
    return DEFAULT_UI_PORT;
  }
}

/** `http://localhost:<port>`, using the configured port or the default. */
export function uiBaseUrl(root: string): string {
  return `http://localhost:${resolveUiPort(root)}`;
}

/**
 * Builds the dashboard URL for a project document. The dashboard's project
 * route parses the URL as `['projects', <project>, 'docs', ...rest]` and
 * reconstructs the document's relative path from every segment after
 * `docs/`, so each path segment is encoded separately and the slashes are
 * kept — a nested path such as `phases/P01.md` must arrive as two encoded
 * segments, not one encoded string containing `%2F`.
 */
export function projectDocUrl(root: string, projectName: string, docRelPath: string): string {
  const segments = docRelPath.split('/').map(encodeURIComponent);
  return [uiBaseUrl(root), 'projects', encodeURIComponent(projectName), 'docs', ...segments].join('/');
}
