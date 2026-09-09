import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  parseStyleFile,
  listStyles,
  resolveStylePath,
  resolveStyleRef,
  readSelectedStyle,
  saveCustomStyle,
} from '../../src/lib/communication-style.js';
import { UserError } from '../../src/framework/errors.js';

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'comm-style-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

const write = (rel: string, text: string) => {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text, 'utf8');
  return abs;
};

const styleText = (name: string, title = 'Title', description = 'A description.', body = '## Tone\n- Neutral.\n') =>
  `---\nname: ${name}\ntitle: ${title}\ndescription: ${description}\n---\n\n${body}`;

describe('parseStyleFile', () => {
  it('parses frontmatter and body when name agrees with the filename stem', () => {
    const parsed = parseStyleFile(styleText('direct'), 'direct.md');
    expect(parsed.name).toBe('direct');
    expect(parsed.frontmatter).toEqual({ name: 'direct', title: 'Title', description: 'A description.' });
    expect(parsed.body).toContain('## Tone');
  });

  it('throws when frontmatter.name disagrees with the filename stem', () => {
    expect(() => parseStyleFile(styleText('other'), 'direct.md')).toThrow(/disagrees with filename stem/);
  });

  it('throws when title is missing', () => {
    const text = '---\nname: direct\ndescription: A description.\n---\nbody\n';
    expect(() => parseStyleFile(text, 'direct.md')).toThrow(/title/);
  });

  it('throws when frontmatter is not an object', () => {
    const text = '---\njust a scalar string\n---\nbody\n';
    expect(() => parseStyleFile(text, 'direct.md')).toThrow(/non-object frontmatter/);
  });

  it('throws when the filename does not match the catalog naming rule', () => {
    expect(() => parseStyleFile(styleText('Direct'), 'Direct.md')).toThrow(/Invalid style filename/);
  });

  it('throws when the frontmatter block is missing', () => {
    expect(() => parseStyleFile('no frontmatter here', 'direct.md')).toThrow(/missing YAML frontmatter/);
  });
});

describe('listStyles', () => {
  it('lists shipped styles and skips a malformed file with a warning', () => {
    write('direct.md', styleText('direct'));
    write('broken.md', 'not frontmatter at all');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const entries = listStyles(root);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({ path: 'direct.md', name: 'direct', title: 'Title', description: 'A description.', isCustom: false });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('returns [] when the catalog root does not exist', () => {
    expect(listStyles(path.join(root, 'nope'))).toEqual([]);
  });

  it('returns no custom entries when custom/ is missing entirely', () => {
    write('direct.md', styleText('direct'));
    const entries = listStyles(root);
    expect(entries.every((e) => !e.isCustom)).toBe(true);
  });

  it('resolves a shipped and a same-named custom style as two distinct entries', () => {
    write('direct.md', styleText('direct'));
    write('custom/direct.md', styleText('direct', 'Custom Direct'));
    const entries = listStyles(root);
    expect(entries).toHaveLength(2);
    const shipped = entries.find((e) => !e.isCustom);
    const custom = entries.find((e) => e.isCustom);
    expect(shipped).toEqual({ path: 'direct.md', name: 'direct', title: 'Title', description: 'A description.', isCustom: false });
    expect(custom).toEqual({ path: 'custom/direct.md', name: 'direct', title: 'Custom Direct', description: 'A description.', isCustom: true });
  });
});

describe('resolveStylePath', () => {
  it('resolves a shipped style path', () => {
    write('direct.md', styleText('direct'));
    expect(resolveStylePath(root, 'direct.md')).toBe(path.join(root, 'direct.md'));
  });

  it('resolves a custom style path', () => {
    expect(resolveStylePath(root, 'custom/my-style.md')).toBe(path.join(root, 'custom', 'my-style.md'));
  });

  it('rejects a relative escape out of the catalog root', () => {
    expect(resolveStylePath(root, '../../.ssh/id_rsa.md')).toBeNull();
  });

  it('rejects an absolute path', () => {
    const abs = path.isAbsolute('C:\\Windows\\win.ini') ? 'C:\\Windows\\win.ini' : '/etc/passwd';
    expect(resolveStylePath(root, abs)).toBeNull();
  });

  it('rejects an empty selection', () => {
    expect(resolveStylePath(root, '')).toBeNull();
  });

  it('rejects a non-.md file', () => {
    expect(resolveStylePath(root, 'direct.txt')).toBeNull();
  });
});

describe('resolveStyleRef', () => {
  it('resolves a shipped slug against the catalog root', () => {
    write('unicorn-speak.md', styleText('unicorn-speak'));
    expect(resolveStyleRef(root, 'unicorn-speak')).toEqual({
      rel: 'unicorn-speak.md',
      abs: path.join(root, 'unicorn-speak.md'),
    });
  });

  it('resolves a custom slug when only the custom file exists', () => {
    write('custom/unicorn-speak.md', styleText('unicorn-speak'));
    expect(resolveStyleRef(root, 'unicorn-speak')).toEqual({
      rel: 'custom/unicorn-speak.md',
      abs: path.join(root, 'custom', 'unicorn-speak.md'),
    });
  });

  it('resolves the custom copy when both a shipped and a custom file share the slug', () => {
    write('unicorn-speak.md', styleText('unicorn-speak'));
    write('custom/unicorn-speak.md', styleText('unicorn-speak'));
    expect(resolveStyleRef(root, 'unicorn-speak')).toEqual({
      rel: 'custom/unicorn-speak.md',
      abs: path.join(root, 'custom', 'unicorn-speak.md'),
    });
  });

  it('returns null for an unmatched slug', () => {
    expect(resolveStyleRef(root, 'unicorn-speak')).toBeNull();
  });

  it.each([
    ['uppercase', 'Unicorn'],
    ['a separator', 'custom/mine'],
    ['a traversal segment', '../escape'],
    ['an empty string', ''],
  ])('rejects %s before any filesystem access', (_label, ref) => {
    const existsSync = vi.spyOn(fs, 'existsSync');
    expect(resolveStyleRef(root, ref)).toBeNull();
    expect(existsSync).not.toHaveBeenCalled();
    existsSync.mockRestore();
  });

  it('rejects an absolute .md path', () => {
    const abs = path.isAbsolute('C:\\Windows\\win.ini') ? 'C:\\Windows\\win.ini' : '/abs/path.md';
    expect(resolveStyleRef(root, abs)).toBeNull();
  });

  it('resolves a direct .md path exactly as resolveStylePath does', () => {
    write('direct.md', styleText('direct'));
    const ref = resolveStyleRef(root, 'direct.md');
    expect(ref?.abs).toBe(resolveStylePath(root, 'direct.md'));
    expect(ref?.rel).toBe('direct.md');
  });

  it('resolves a custom/*.md path exactly as resolveStylePath does', () => {
    write('custom/mine.md', styleText('mine'));
    const ref = resolveStyleRef(root, 'custom/mine.md');
    expect(ref?.abs).toBe(resolveStylePath(root, 'custom/mine.md'));
    expect(ref?.rel).toBe('custom/mine.md');
  });

  it('returns null when the probe itself throws', () => {
    write('unicorn-speak.md', styleText('unicorn-speak'));
    const statSpy = vi.spyOn(fs, 'statSync').mockImplementation(() => { throw new Error('EACCES'); });
    expect(resolveStyleRef(root, 'unicorn-speak')).toBeNull();
    statSpy.mockRestore();
  });
});

describe('readSelectedStyle', () => {
  it('returns the parsed style for a valid selection', () => {
    write('direct.md', styleText('direct'));
    const parsed = readSelectedStyle(root, 'direct.md');
    expect(parsed?.name).toBe('direct');
  });

  it('resolves and reads a bare slug', () => {
    write('custom/unicorn-speak.md', styleText('unicorn-speak'));
    const parsed = readSelectedStyle(root, 'unicorn-speak');
    expect(parsed?.name).toBe('unicorn-speak');
  });

  it('returns null, never throws, when the slug probe itself fails', () => {
    write('unicorn-speak.md', styleText('unicorn-speak'));
    const statSpy = vi.spyOn(fs, 'statSync').mockImplementation(() => { throw new Error('EACCES'); });
    expect(() => readSelectedStyle(root, 'unicorn-speak')).not.toThrow();
    expect(readSelectedStyle(root, 'unicorn-speak')).toBeNull();
    statSpy.mockRestore();
  });

  it('returns null for a containment-escaping selection', () => {
    expect(readSelectedStyle(root, '../../.ssh/id_rsa.md')).toBeNull();
  });

  it('returns null for an absolute-path selection', () => {
    const abs = path.isAbsolute('C:\\Windows\\win.ini') ? 'C:\\Windows\\win.ini' : '/etc/passwd';
    expect(readSelectedStyle(root, abs)).toBeNull();
  });

  it('returns null for a missing file', () => {
    expect(readSelectedStyle(root, 'missing.md')).toBeNull();
  });

  it('returns null for an unparseable file', () => {
    write('broken.md', 'not frontmatter at all');
    expect(readSelectedStyle(root, 'broken.md')).toBeNull();
  });

  it('returns null when the body is empty or whitespace-only', () => {
    write('empty.md', '---\nname: empty\ntitle: Empty\ndescription: none\n---\n   \n');
    expect(readSelectedStyle(root, 'empty.md')).toBeNull();
  });
});

describe('saveCustomStyle', () => {
  it('creates custom/<name>.md even when custom/ did not exist', () => {
    const result = saveCustomStyle({ catalogRoot: root, name: 'my-style', sourceText: styleText('my-style') });
    expect(result).toEqual({ path: 'custom/my-style.md', overwritten: false });
    expect(fs.existsSync(path.join(root, 'custom', 'my-style.md'))).toBe(true);
  });

  it('reports overwritten: true when the destination already existed', () => {
    write('custom/my-style.md', styleText('my-style', 'Old Title'));
    const result = saveCustomStyle({ catalogRoot: root, name: 'my-style', sourceText: styleText('my-style', 'New Title') });
    expect(result).toEqual({ path: 'custom/my-style.md', overwritten: true });
    expect(fs.readFileSync(path.join(root, 'custom', 'my-style.md'), 'utf8')).toContain('New Title');
  });

  it('throws UserError for a name that attempts to escape the custom folder', () => {
    expect(() => saveCustomStyle({ catalogRoot: root, name: '../evil', sourceText: styleText('evil') }))
      .toThrow(UserError);
  });

  it('throws UserError for a name containing a path separator', () => {
    expect(() => saveCustomStyle({ catalogRoot: root, name: 'sub/dir', sourceText: styleText('dir') }))
      .toThrow(UserError);
  });

  it('throws UserError for a name with a leading dot', () => {
    expect(() => saveCustomStyle({ catalogRoot: root, name: '.hidden', sourceText: styleText('hidden') }))
      .toThrow(UserError);
  });

  it('throws UserError when the source text fails parsing', () => {
    expect(() => saveCustomStyle({ catalogRoot: root, name: 'my-style', sourceText: 'not frontmatter' }))
      .toThrow(UserError);
  });
});
