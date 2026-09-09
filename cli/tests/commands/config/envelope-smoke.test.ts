import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { configCommand, readConfig } from '../../../src/commands/config/index.js';

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-env-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('config envelope smoke', () => {
  it('handler returns the data block the default envelope wraps as ok:true', () => {
    fs.writeFileSync(path.join(root, 'orchestration.yml'), 'source_control:\n  auto_commit: never\n  auto_pr: always\n');
    const data = readConfig({ root });
    const envelope = configCommand.mapResult ? configCommand.mapResult(data) : { ok: true, data };
    expect(envelope).toEqual({
      ok: true,
      data: {
        autoCommit: 'never',
        autoPr: 'always',
        telemetryEnabled: false,
        ambientVerbosity: 'minimal',
        communicationStyle: { enabled: false, selected: 'high-level.md' },
      },
    });
  });
});
