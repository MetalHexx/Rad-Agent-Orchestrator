import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { configSetVerbosity, configSetVerbosityCommand } from '../../../src/commands/config/set-verbosity.js';
import { readConfig } from '../../../src/commands/config/index.js';
import { UserError } from '../../../src/framework/errors.js';

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-set-verbosity-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

const configPath = () => path.join(root, 'orchestration.yml');
const write = (yml: string) => fs.writeFileSync(configPath(), yml);

describe('configSetVerbosity', () => {
  it('writes a valid level and reads it back via readConfig', () => {
    const result = configSetVerbosity({ root, level: 'minimal' });
    expect(result).toEqual({ verbosity: 'minimal' });
    expect(readConfig({ root }).ambientVerbosity).toBe('minimal');
  });

  it('creates the file fresh with just the ambient_awareness key when missing', () => {
    configSetVerbosity({ root, level: 'silent' });
    const written = fs.readFileSync(configPath(), 'utf8');
    expect(written).toContain('ambient_awareness');
    expect(readConfig({ root }).ambientVerbosity).toBe('silent');
  });

  it('preserves every other existing top-level key on write', () => {
    write('source_control:\n  auto_commit: always\n  auto_pr: never\n');
    configSetVerbosity({ root, level: 'off' });
    const cfg = readConfig({ root });
    expect(cfg.autoCommit).toBe('always');
    expect(cfg.autoPr).toBe('never');
    expect(cfg.ambientVerbosity).toBe('off');
  });

  it('throws UserError for an invalid level and leaves the file untouched', () => {
    write('source_control:\n  auto_commit: always\n  auto_pr: never\n');
    const before = fs.readFileSync(configPath(), 'utf8');
    expect(() => configSetVerbosity({ root, level: 'bogus' })).toThrow(UserError);
    expect(() => configSetVerbosity({ root, level: 'bogus' })).toThrow(/verbose, minimal, silent, off/);
    expect(fs.readFileSync(configPath(), 'utf8')).toBe(before);
  });

  it('does not write a file at all for an invalid level when none existed', () => {
    expect(() => configSetVerbosity({ root, level: 'bogus' })).toThrow(UserError);
    expect(fs.existsSync(configPath())).toBe(false);
  });
});

describe('configSetVerbosityCommand', () => {
  it('declares level as a required arg (like every other required-value command), not an optional flag', () => {
    expect(configSetVerbosityCommand.args.level?.required).toBe(true);
    expect(configSetVerbosityCommand.flags).not.toHaveProperty('level');
  });
});
