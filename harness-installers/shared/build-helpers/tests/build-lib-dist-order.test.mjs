import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const builders = [
  'harness-installers/standard/build-scripts/build.js',
  'harness-installers/claude-plugin/build-scripts/build.js',
  'harness-installers/copilot-cli-plugin/build-scripts/build.js',
  'harness-installers/copilot-vscode-plugin/build-scripts/build.js',
];

const EXPECTED_ORDER = [
  '@rad-orchestration/repo-registry',
  '@rad-orchestration/work-graph',
  '@rad-orchestration/telemetry',
];

test('build-lib-dist precedes emit-cli-bundle and emit-ui-bundle in every builder', () => {
  for (const rel of builders) {
    const src = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
    const lib = src.indexOf("step('build-lib-dist'");
    const cli = src.indexOf("step('emit-cli-bundle'");
    const ui = src.indexOf("step('emit-ui-bundle'");
    assert.ok(lib !== -1, `${rel} missing build-lib-dist`);
    assert.ok(lib < cli, `${rel} build-lib-dist must precede emit-cli-bundle`);
    assert.ok(lib < ui, `${rel} build-lib-dist must precede emit-ui-bundle`);
  }
});

test('build-lib-dist step builds repo-registry → work-graph → telemetry in every builder', () => {
  for (const rel of builders) {
    const src = fs.readFileSync(path.join(repoRoot, rel), 'utf8');

    // Extract the body of the build-lib-dist step block to scope position checks
    // to just the packages inside that step, not incidental mentions elsewhere.
    const stepStart = src.indexOf("step('build-lib-dist'");
    assert.ok(stepStart !== -1, `${rel} missing build-lib-dist step`);

    // Find closing brace of the step callback — locate the matching '})' after stepStart.
    const stepRegion = src.slice(stepStart);

    for (const pkg of EXPECTED_ORDER) {
      assert.ok(
        stepRegion.includes(pkg),
        `${rel} build-lib-dist step must include ${pkg}`,
      );
    }

    // Assert dependency order: each package appears before the next one in the step region.
    for (let i = 0; i < EXPECTED_ORDER.length - 1; i++) {
      const earlier = EXPECTED_ORDER[i];
      const later = EXPECTED_ORDER[i + 1];
      const posEarlier = stepRegion.indexOf(earlier);
      const posLater = stepRegion.indexOf(later);
      assert.ok(
        posEarlier < posLater,
        `${rel} build-lib-dist step: ${earlier} must appear before ${later}`,
      );
    }
  }
});
