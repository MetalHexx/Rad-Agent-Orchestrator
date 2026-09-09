import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { communicationStyleSet } from '../../../src/commands/communication-style/set.js';
import { readConfig } from '../../../src/commands/config/index.js';
import { UserError } from '../../../src/framework/errors.js';

let root: string;
let catalogRoot: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'comm-style-set-root-'));
  catalogRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'comm-style-set-catalog-'));
  fs.writeFileSync(path.join(catalogRoot, 'direct.md'), '---\nname: direct\ntitle: Direct\ndescription: Desc.\n---\n\nbody\n');
  fs.mkdirSync(path.join(catalogRoot, 'custom'), { recursive: true });
  fs.writeFileSync(path.join(catalogRoot, 'custom', 'unicorn-speak.md'), '---\nname: unicorn-speak\ntitle: Unicorn\ndescription: Desc.\n---\n\nbody\n');
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(catalogRoot, { recursive: true, force: true });
});

const configPath = () => path.join(root, 'orchestration.yml');
const write = (yml: string) => fs.writeFileSync(configPath(), yml);

describe('communicationStyleSet', () => {
  it('writes --selected and reads it back via readConfig', () => {
    const result = communicationStyleSet({ root, catalogRoot, selected: 'direct.md' });
    expect(result).toEqual({ enabled: false, selected: 'direct.md' });
    expect(readConfig({ root }).communicationStyle.selected).toBe('direct.md');
  });

  it('resolves a bare slug to its resolved path, not the raw slug, on a combined write', () => {
    const result = communicationStyleSet({ root, catalogRoot, selected: 'unicorn-speak', enabled: 'true' });
    expect(result).toEqual({ enabled: true, selected: 'custom/unicorn-speak.md' });
    const cfg = readConfig({ root });
    expect(cfg.communicationStyle).toEqual({ enabled: true, selected: 'custom/unicorn-speak.md' });
  });

  it('writes --enabled true/false', () => {
    communicationStyleSet({ root, catalogRoot, enabled: 'true' });
    expect(readConfig({ root }).communicationStyle.enabled).toBe(true);
    communicationStyleSet({ root, catalogRoot, enabled: 'false' });
    expect(readConfig({ root }).communicationStyle.enabled).toBe(false);
  });

  it('preserves every other existing orchestration.yml key on write', () => {
    write('source_control:\n  auto_commit: always\n  auto_pr: never\n');
    communicationStyleSet({ root, catalogRoot, selected: 'direct.md' });
    const cfg = readConfig({ root });
    expect(cfg.autoCommit).toBe('always');
    expect(cfg.autoPr).toBe('never');
    expect(cfg.communicationStyle.selected).toBe('direct.md');
  });

  it('throws UserError when neither --selected nor --enabled is supplied', () => {
    expect(() => communicationStyleSet({ root, catalogRoot })).toThrow(UserError);
  });

  it('throws UserError when --selected does not resolve to an existing style', () => {
    expect(() => communicationStyleSet({ root, catalogRoot, selected: 'custom/nope.md' })).toThrow(UserError);
  });

  it('throws UserError naming the value when --selected is an unmatched slug', () => {
    expect(() => communicationStyleSet({ root, catalogRoot, selected: 'nope' })).toThrow(/--selected 'nope'/);
  });

  it('throws UserError when --selected escapes the catalog root', () => {
    expect(() => communicationStyleSet({ root, catalogRoot, selected: '../../.ssh/id_rsa.md' })).toThrow(UserError);
  });

  it('throws UserError when --enabled is not exactly true or false', () => {
    expect(() => communicationStyleSet({ root, catalogRoot, enabled: 'yes' })).toThrow(UserError);
  });

  it('leaves the file untouched on a validation failure', () => {
    write('source_control:\n  auto_commit: always\n  auto_pr: never\n');
    const before = fs.readFileSync(configPath(), 'utf8');
    expect(() => communicationStyleSet({ root, catalogRoot, enabled: 'yes' })).toThrow(UserError);
    expect(fs.readFileSync(configPath(), 'utf8')).toBe(before);
  });
});
