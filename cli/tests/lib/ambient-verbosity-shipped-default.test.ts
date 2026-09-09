// Guards the seam between the shipped config and the CLI's coercion fallback:
// `runtime-config/orchestration.yml` and `normalizeAmbientVerbosity`'s fallback
// must agree on the fresh-install verbosity level. Reaches `runtime-config/**`
// by relative path — the same pattern as `action-event-loader.test.ts`'s
// `CATALOG_ROOT` — sanctioned because `cli.yml`'s trigger paths include
// `runtime-config/**`, so this suite actually runs when only the shipped YAML
// changes.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseYaml } from '../../src/lib/yaml.js';
import { normalizeAmbientVerbosity } from '../../src/lib/ambient-verbosity.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('shipped orchestration.yml', () => {
  it('resolves ambient_awareness.verbosity to minimal', () => {
    const shippedPath = path.join(repoRoot, 'runtime-config', 'orchestration.yml');
    const parsed = parseYaml<{ ambient_awareness?: { verbosity?: unknown } }>(fs.readFileSync(shippedPath, 'utf8'));
    const resolved = normalizeAmbientVerbosity(parsed?.ambient_awareness?.verbosity);
    expect(resolved).toBe('minimal');
  });
});
