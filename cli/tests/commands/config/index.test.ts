import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readConfig } from '../../../src/commands/config/index.js';

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

const write = (yml: string) => fs.writeFileSync(path.join(root, 'orchestration.yml'), yml);

describe('radorch config', () => {
  const defaultCommunicationStyle = { enabled: false, selected: 'high-level.md' };

  it('reads auto_commit and auto_pr from orchestration.yml', () => {
    write('source_control:\n  auto_commit: always\n  auto_pr: never\n');
    expect(readConfig({ root })).toEqual({ autoCommit: 'always', autoPr: 'never', telemetryEnabled: false, ambientVerbosity: 'minimal', communicationStyle: defaultCommunicationStyle });
  });
  it('defaults both values to ask when the file is missing', () => {
    expect(readConfig({ root })).toEqual({ autoCommit: 'ask', autoPr: 'ask', telemetryEnabled: false, ambientVerbosity: 'minimal', communicationStyle: defaultCommunicationStyle });
  });
  it('defaults a missing key to ask while keeping the present one', () => {
    write('source_control:\n  auto_commit: always\n');
    expect(readConfig({ root })).toEqual({ autoCommit: 'always', autoPr: 'ask', telemetryEnabled: false, ambientVerbosity: 'minimal', communicationStyle: defaultCommunicationStyle });
  });

  describe('communication_style', () => {
    it('defaults to disabled + high-level.md when the section is absent', () => {
      expect(readConfig({ root }).communicationStyle).toEqual(defaultCommunicationStyle);
    });
    it('reads a fully-specified section', () => {
      write('communication_style:\n  enabled: true\n  selected: custom/my-style.md\n');
      expect(readConfig({ root }).communicationStyle).toEqual({ enabled: true, selected: 'custom/my-style.md' });
    });
    it('defaults selected while keeping enabled when only enabled is present', () => {
      write('communication_style:\n  enabled: true\n');
      expect(readConfig({ root }).communicationStyle).toEqual({ enabled: true, selected: 'high-level.md' });
    });
    it('treats a non-boolean-true enabled value as false', () => {
      write('communication_style:\n  enabled: "yes"\n  selected: direct.md\n');
      expect(readConfig({ root }).communicationStyle).toEqual({ enabled: false, selected: 'direct.md' });
    });
    it('degrades to defaults when the section is not an object', () => {
      write('communication_style: nope\n');
      expect(readConfig({ root }).communicationStyle).toEqual(defaultCommunicationStyle);
    });
  });

  describe('ambient_awareness.verbosity', () => {
    it('round-trips each configured level', () => {
      for (const level of ['verbose', 'minimal', 'silent', 'off']) {
        write(`ambient_awareness:\n  verbosity: ${level}\n`);
        expect(readConfig({ root }).ambientVerbosity).toBe(level);
      }
    });
    it('degrades to minimal when the block is absent', () => {
      write('telemetry:\n  enabled: true\n');
      expect(readConfig({ root }).ambientVerbosity).toBe('minimal');
    });
    it('degrades to minimal when the value is unrecognized', () => {
      write('ambient_awareness:\n  verbosity: loud\n');
      expect(readConfig({ root }).ambientVerbosity).toBe('minimal');
    });
    it('degrades to minimal when the value is not a scalar string', () => {
      write('ambient_awareness:\n  verbosity:\n    - minimal\n');
      expect(readConfig({ root }).ambientVerbosity).toBe('minimal');
    });
    it('an existing config value wins over the shipped default', () => {
      write('ambient_awareness:\n  verbosity: verbose\n');
      expect(readConfig({ root }).ambientVerbosity).toBe('verbose');
    });
  });
});
