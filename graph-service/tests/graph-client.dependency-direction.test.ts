// graph-service/tests/graph-client.dependency-direction.test.ts
//
// Regression guard for the D25 dependency-direction invariant between graph-service and its own
// HTTP client: `@rad-orchestration/graph-client` is a leaf that talks to a *running* service over
// HTTP, so it must never import the service (or the engine it composes) back in, and the service
// must never depend on the client at all — the whole point of shipping a client is that the
// service it fronts never needs it. `devDependencies` are exempt: this suite's own test-time edge
// (graph-service depends on graph-client only to drive it in
// `graph-client.integration.test.ts`) is the one sanctioned exception.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

interface Manifest {
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
}

const testDir = path.dirname(fileURLToPath(import.meta.url));
const serviceRoot = path.resolve(testDir, '..');
const clientRoot = path.resolve(serviceRoot, '../lib/graph-client');

function readManifest(root: string): Manifest {
  return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as Manifest;
}

describe('anti-regression: dependency direction between graph-service and graph-client (D25)', () => {
  it("graph-client's production dependencies never pull in graph-service or graph-engine", () => {
    const manifest = readManifest(clientRoot);
    expect(manifest.dependencies ?? {}).not.toHaveProperty('@rad-orchestration/graph-service');
    expect(manifest.dependencies ?? {}).not.toHaveProperty('@rad-orchestration/graph-engine');
  });

  it("graph-service's production dependencies never pull in graph-client (devDependencies are exempt)", () => {
    const manifest = readManifest(serviceRoot);
    expect(manifest.dependencies ?? {}).not.toHaveProperty('@rad-orchestration/graph-client');
  });
});
