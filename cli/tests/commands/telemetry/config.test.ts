import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readTelemetryEnabled } from '../../../src/commands/telemetry/config.js';

function tmpRoot(yml?: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tel-gate-'));
  if (yml !== undefined) fs.writeFileSync(path.join(root, 'orchestration.yml'), yml, 'utf8');
  return root;
}

describe('readTelemetryEnabled — opt-in default-off (FR-5, AD-5)', () => {
  it('returns false when orchestration.yml is missing', () => {
    expect(readTelemetryEnabled({ root: tmpRoot() })).toBe(false);
  });
  it('returns false when the telemetry key is absent', () => {
    expect(readTelemetryEnabled({ root: tmpRoot('source_control:\n  auto_commit: ask\n') })).toBe(false);
  });
  it('returns false when YAML is malformed', () => {
    expect(readTelemetryEnabled({ root: tmpRoot('telemetry: : :\n  enabled\n') })).toBe(false);
  });
  it('returns true only when explicitly enabled', () => {
    expect(readTelemetryEnabled({ root: tmpRoot('telemetry:\n  enabled: true\n') })).toBe(true);
  });
  it('returns false when explicitly disabled', () => {
    expect(readTelemetryEnabled({ root: tmpRoot('telemetry:\n  enabled: false\n') })).toBe(false);
  });
});
