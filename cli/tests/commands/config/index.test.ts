import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readConfig } from '../../../src/commands/config/index.js';

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('radorch config', () => {
  it('reads auto_commit and auto_pr from orchestration.yml', () => {
    fs.writeFileSync(
      path.join(root, 'orchestration.yml'),
      'source_control:\n  auto_commit: always\n  auto_pr: never\n',
    );
    expect(readConfig({ root })).toEqual({ autoCommit: 'always', autoPr: 'never', telemetryEnabled: false });
  });
  it('defaults both values to ask when the file is missing', () => {
    expect(readConfig({ root })).toEqual({ autoCommit: 'ask', autoPr: 'ask', telemetryEnabled: false });
  });
  it('defaults a missing key to ask while keeping the present one', () => {
    fs.writeFileSync(path.join(root, 'orchestration.yml'), 'source_control:\n  auto_commit: always\n');
    expect(readConfig({ root })).toEqual({ autoCommit: 'always', autoPr: 'ask', telemetryEnabled: false });
  });
});
