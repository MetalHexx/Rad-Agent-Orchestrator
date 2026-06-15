import { describe, it, expect } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { userDataPaths } from '../../../src/lib/paths.js';
import { readTelemetryEnabled } from '../../../src/commands/telemetry/config.js';

function tmpRootWith(yml: string | null): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'radorc-'));
  if (yml !== null) fs.writeFileSync(path.join(root, 'orchestration.yml'), yml, 'utf8');
  return root;
}

describe('telemetry path + gate', () => {
  it('exposes the telemetry store root under ~/.radorc (AD-4)', () => {
    expect(userDataPaths().telemetry).toBe(path.join(os.homedir(), '.radorc', 'telemetry'));
  });
  it('defaults ON when the key is absent (FR-7)', () => {
    expect(readTelemetryEnabled({ root: tmpRootWith('source_control:\n  auto_commit: ask\n') })).toBe(true);
  });
  it('defaults ON when orchestration.yml is missing entirely (FR-7)', () => {
    expect(readTelemetryEnabled({ root: tmpRootWith(null) })).toBe(true);
  });
  it('honors an explicit false (FR-7)', () => {
    expect(readTelemetryEnabled({ root: tmpRootWith('telemetry:\n  enabled: false\n') })).toBe(false);
  });
  it('degrades to ON (default) on malformed yaml, never throws (FR-7)', () => {
    expect(readTelemetryEnabled({ root: tmpRootWith('telemetry: : :\n  ]][[') })).toBe(true);
  });
});
