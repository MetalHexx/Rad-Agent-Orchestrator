import fs from 'node:fs';
import path from 'node:path';
import { parseYaml } from '../../lib/yaml.js';

interface TelemetryConfig { telemetry?: { enabled?: unknown }; }

// Master gate (FR-5, AD-5): default OFF, opt-in only. orchestration.yml is the only
// override source; an absent/malformed file leaves telemetry disabled.
export function readTelemetryEnabled({ root }: { root: string }): boolean {
  const configPath = path.join(root, 'orchestration.yml');
  if (!fs.existsSync(configPath)) return false;          // was: return true
  try {
    const parsed = parseYaml<TelemetryConfig>(fs.readFileSync(configPath, 'utf8'));
    return parsed?.telemetry?.enabled === true;          // was: === false ? false : true
  } catch {
    return false;                                        // was: return true
  }
}
