import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { communicationStyleLoad } from '../../../src/commands/communication-style/load.js';
import { UserError } from '../../../src/framework/errors.js';

let root: string;
let catalogRoot: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'comm-style-load-root-'));
  catalogRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'comm-style-load-catalog-'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(catalogRoot, { recursive: true, force: true });
});

const writeStyle = (rel: string, name: string, title = 'Title', description = 'Desc.') => {
  const abs = path.join(catalogRoot, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `---\nname: ${name}\ntitle: ${title}\ndescription: ${description}\n---\n\n## Tone\n- Neutral.\n`, 'utf8');
};

describe('communicationStyleLoad', () => {
  it('resolves a bare slug and reports the resolved catalog-relative path', () => {
    writeStyle('custom/unicorn-speak.md', 'unicorn-speak', 'Unicorn Speak');
    const result = communicationStyleLoad({ root, catalogRoot, style: 'unicorn-speak' });
    expect(result.path).toBe('custom/unicorn-speak.md');
    expect(result.name).toBe('unicorn-speak');
    expect(result.title).toBe('Unicorn Speak');
    expect(result.description).toBe('Desc.');
    expect(result.body).toContain('## Tone');
  });

  it('behaves as today for a path-form input', () => {
    writeStyle('direct.md', 'direct', 'Direct');
    const result = communicationStyleLoad({ root, catalogRoot, style: 'direct.md' });
    expect(result.path).toBe('direct.md');
    expect(result.name).toBe('direct');
  });

  it('falls back to config.communicationStyle.selected when no --style is given', () => {
    fs.writeFileSync(path.join(root, 'orchestration.yml'), 'communication_style:\n  enabled: true\n  selected: direct.md\n');
    writeStyle('direct.md', 'direct', 'Direct');
    const result = communicationStyleLoad({ root, catalogRoot });
    expect(result.path).toBe('direct.md');
  });

  it('throws a user_error when the value does not resolve within the catalog', () => {
    try {
      communicationStyleLoad({ root, catalogRoot, style: 'nope' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(UserError);
      expect((err as UserError).message).toMatch(/does not resolve within the communication-styles catalog/);
    }
  });

  it('throws a user_error when the resolved value is not a real path form and the file is absent', () => {
    try {
      communicationStyleLoad({ root, catalogRoot, style: '../../.ssh/id_rsa.md' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(UserError);
      expect((err as UserError).message).toMatch(/does not resolve within the communication-styles catalog/);
    }
  });

  it('throws a user_error naming the catalog-miss when a well-formed path is not found', () => {
    try {
      communicationStyleLoad({ root, catalogRoot, style: 'missing.md' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(UserError);
      expect((err as UserError).message).toMatch(/was not found in the catalog/);
    }
  });
});
