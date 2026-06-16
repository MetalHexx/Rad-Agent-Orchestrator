// harness-installers/standard/tests/install/telemetry-sacred-folder.test.mjs —
// FR-11, AD-10. Asserts the standard installer declares telemetry/ as a
// sacred path and skips it during uninstall pruning.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { userDataPaths } from '../../lib/install/user-data-paths.js';
import { removeManifestFiles } from '../../lib/install/remove-files.js';

function withHome(home) {
  const prevHome = process.env.HOME;
  const prevUserProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  return () => {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevUserProfile;
  };
}

test('telemetry path is declared (FR-11, AD-10)', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sacred-'));
  const paths = userDataPaths({ home });
  assert.equal(paths.telemetry, path.join(home, '.radorc', 'telemetry'));
  fs.rmSync(home, { recursive: true, force: true });
});

test('telemetry/usage/x.ndjson survives uninstall pruning (FR-11)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sacred-'));
  const home = path.join(tmp, 'home');
  const restoreHome = withHome(home);
  try {
    const radHome = path.join(home, '.radorc');

    // Seed a file under telemetry/ that must survive uninstall.
    const telemetryUsageDir = path.join(radHome, 'telemetry', 'usage');
    fs.mkdirSync(telemetryUsageDir, { recursive: true });
    const telemetryFile = path.join(telemetryUsageDir, 'x.ndjson');
    fs.writeFileSync(telemetryFile, '{"event":"test"}\n');

    // Build a manifest with an entry that targets a path inside telemetry/.
    const manifest = {
      files: [
        {
          bundlePath: 'telemetry/usage/x.ndjson',
          destinationPath: '${RAD_HOME}/telemetry/usage/x.ndjson',
          sha256: 'abc',
        },
      ],
    };

    // removeManifestFiles must skip the telemetry entry and leave the file intact.
    removeManifestFiles(manifest, 'claude');
    assert.ok(fs.existsSync(telemetryFile), 'telemetry file must survive uninstall pruning');
    assert.strictEqual(
      fs.readFileSync(telemetryFile, 'utf8'),
      '{"event":"test"}\n',
      'telemetry file content must be unchanged',
    );
  } finally {
    restoreHome();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
