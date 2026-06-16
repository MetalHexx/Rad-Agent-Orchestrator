// harness-installers/claude-plugin/tests/telemetry-sacred-folder.test.mjs —
// FR-11, AD-10. Asserts the claude-plugin declares telemetry/ as a sacred path
// and skips it during manifest-driven removal.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { userDataPaths } from '../lib/install/user-data-paths.js';
import { removeManifestFiles } from '../lib/install/remove-files.js';

test('telemetry path is declared (FR-11, AD-10)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sacred-'));
  const radHome = path.join(tmp, '.radorc');
  const paths = userDataPaths({ radHome });
  assert.equal(paths.telemetry, path.join(radHome, 'telemetry'));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('telemetry/usage/x.ndjson survives remove (FR-11)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sacred-'));
  const radHome = path.join(tmp, '.radorc');
  try {
    // Seed a file under telemetry/ that must survive manifest-driven removal.
    const telemetryUsageDir = path.join(radHome, 'telemetry', 'usage');
    fs.mkdirSync(telemetryUsageDir, { recursive: true });
    const telemetryFile = path.join(telemetryUsageDir, 'x.ndjson');
    fs.writeFileSync(telemetryFile, '{"event":"test"}\n');

    // Build a manifest with an entry that targets a path inside telemetry/.
    const manifest = {
      files: [
        {
          sourcePath: '_install-source/telemetry/usage/x.ndjson',
          destinationPath: '${RAD_HOME}/telemetry/usage/x.ndjson',
          ownership: 'installer-owned',
        },
      ],
    };

    // removeManifestFiles must skip the telemetry entry and leave the file intact.
    removeManifestFiles(manifest, { radHome });
    assert.ok(fs.existsSync(telemetryFile), 'telemetry file must survive remove');
    assert.strictEqual(
      fs.readFileSync(telemetryFile, 'utf8'),
      '{"event":"test"}\n',
      'telemetry file content must be unchanged',
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
