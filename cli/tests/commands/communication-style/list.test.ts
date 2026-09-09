import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { communicationStyleList } from '../../../src/commands/communication-style/list.js';

let root: string;
let catalogRoot: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'comm-style-list-root-'));
  catalogRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'comm-style-list-catalog-'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(catalogRoot, { recursive: true, force: true });
});

const writeStyle = (rel: string, name: string) => {
  const abs = path.join(catalogRoot, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `---\nname: ${name}\ntitle: Title\ndescription: Desc.\n---\n\n## Tone\n- Neutral.\n`, 'utf8');
};

describe('communicationStyleList', () => {
  it('reports enabled/selected from config alongside the catalog listing', () => {
    fs.writeFileSync(path.join(root, 'orchestration.yml'), 'communication_style:\n  enabled: true\n  selected: direct.md\n');
    writeStyle('direct.md', 'direct');
    const result = communicationStyleList({ root, catalogRoot });
    expect(result.enabled).toBe(true);
    expect(result.selected).toBe('direct.md');
    expect(result.catalogRoot).toBe(catalogRoot);
    expect(result.styles).toEqual([{ path: 'direct.md', name: 'direct', title: 'Title', description: 'Desc.', isCustom: false }]);
  });

  it('defaults to disabled/high-level.md and no custom entries on a fresh catalog', () => {
    writeStyle('high-level.md', 'high-level');
    writeStyle('direct.md', 'direct');
    writeStyle('caveman.md', 'caveman');
    writeStyle('socratic.md', 'socratic');
    const result = communicationStyleList({ root, catalogRoot });
    expect(result.enabled).toBe(false);
    expect(result.selected).toBe('high-level.md');
    expect(result.styles).toHaveLength(4);
    expect(result.styles.every((s) => !s.isCustom)).toBe(true);
  });
});
