// tests/lib/drift-hint.test.mjs — Cross-channel drift hint derived from
// ~/.radorc/install.json (AD-15, FR-9). Every case stages a tmpdir with a
// synthetic install.json and passes `installJsonPath` explicitly so the real
// ~/.radorc is never read (NFR-9).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { computeDriftHint } from '../../lib/drift-hint.js';

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeInstallJson(tmpDir, contents) {
  const p = path.join(tmpDir, 'install.json');
  fs.writeFileSync(
    p,
    typeof contents === 'string' ? contents : JSON.stringify(contents, null, 2),
  );
  return p;
}

describe('computeDriftHint — defensive defaults (NFR-4)', () => {
  it('returns null when install.json is absent', () => {
    const tmp = mkTmp('std-drift-hint-abs-');
    try {
      const installJsonPath = path.join(tmp, 'install.json');
      const result = computeDriftHint({ installJsonPath });
      assert.equal(result, null);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('returns null when install.json is malformed JSON', () => {
    const tmp = mkTmp('std-drift-hint-bad-');
    try {
      const installJsonPath = writeInstallJson(tmp, '{ not valid json');
      const result = computeDriftHint({ installJsonPath });
      assert.equal(result, null);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('returns null when only a claude entry exists (no plugin counterpart)', () => {
    const tmp = mkTmp('std-drift-hint-claude-only-');
    try {
      const installJsonPath = writeInstallJson(tmp, {
        harnesses: {
          claude: { version: '1.0.0-alpha.12' },
        },
      });
      const result = computeDriftHint({ installJsonPath });
      assert.equal(result, null);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('returns null when only a claude-plugin entry exists (no standard counterpart)', () => {
    const tmp = mkTmp('std-drift-hint-plugin-only-');
    try {
      const installJsonPath = writeInstallJson(tmp, {
        harnesses: {
          'claude-plugin': { version: '1.0.0-alpha.12' },
        },
      });
      const result = computeDriftHint({ installJsonPath });
      assert.equal(result, null);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('returns null when both entries exist at the same version', () => {
    const tmp = mkTmp('std-drift-hint-match-');
    try {
      const installJsonPath = writeInstallJson(tmp, {
        harnesses: {
          claude: { version: '1.0.0-alpha.12' },
          'claude-plugin': { version: '1.0.0-alpha.12' },
        },
      });
      const result = computeDriftHint({ installJsonPath });
      assert.equal(result, null);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('computeDriftHint — drift detection (FR-9, AD-15)', () => {
  it('returns a truthy hint with both versions when claude and claude-plugin disagree', () => {
    const tmp = mkTmp('std-drift-hint-mismatch-');
    try {
      const installJsonPath = writeInstallJson(tmp, {
        harnesses: {
          claude: { version: '1.0.0-alpha.12' },
          'claude-plugin': { version: '1.0.0-alpha.8' },
        },
      });
      const result = computeDriftHint({ installJsonPath });
      assert.ok(result, 'expected a truthy drift hint');
      assert.equal(result.installedVersion, '1.0.0-alpha.12');
      assert.equal(result.pluginVersion, '1.0.0-alpha.8');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
