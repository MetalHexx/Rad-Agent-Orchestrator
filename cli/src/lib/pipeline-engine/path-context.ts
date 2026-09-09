import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PathContext } from './types.js';

export function resolvePathContext(): PathContext {
  const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
  const templatesDir = process.env['RADORCH_TEMPLATES_DIR']
    ?? path.join(os.homedir(), '.radorc', 'templates');
  // The one boundary read of the running script's path: the completion-command
  // renderer needs it to emit a command runnable from any working directory,
  // and this is the only place in the engine that reads `process`.
  const scriptPath = process.argv[1] ?? '';
  return { scriptsDir, templatesDir, scriptPath };
}

export function resolveDiscoveredConfigPath(): string {
  return path.join(os.homedir(), '.radorc', 'orchestration.yml');
}
