import fs from 'node:fs';
import path from 'node:path';
import { parseYaml } from '../../lib/yaml.js';

interface TelemetryConfig { telemetry?: { enabled?: unknown }; }

// Master gate (FR-7): default ON, defined in code. orchestration.yml is the only
// override source; an absent/malformed file leaves telemetry enabled.
export function readTelemetryEnabled({ root }: { root: string }): boolean {
  const configPath = path.join(root, 'orchestration.yml');
  if (!fs.existsSync(configPath)) return true;
  try {
    const parsed = parseYaml<TelemetryConfig>(fs.readFileSync(configPath, 'utf8'));
    return parsed?.telemetry?.enabled === false ? false : true;
  } catch {
    return true;
  }
}
