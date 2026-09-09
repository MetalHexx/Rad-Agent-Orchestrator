import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { communicationStyleSave } from '../../../src/commands/communication-style/save.js';
import { UserError } from '../../../src/framework/errors.js';

let catalogRoot: string;
let draftsDir: string;
beforeEach(() => {
  catalogRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'comm-style-save-catalog-'));
  draftsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comm-style-save-drafts-'));
});
afterEach(() => {
  fs.rmSync(catalogRoot, { recursive: true, force: true });
  fs.rmSync(draftsDir, { recursive: true, force: true });
});

const writeDraft = (name: string, text: string) => {
  const abs = path.join(draftsDir, `${name}.md`);
  fs.writeFileSync(abs, text, 'utf8');
  return abs;
};

const styleText = (name: string) => `---\nname: ${name}\ntitle: Title\ndescription: Desc.\n---\n\nbody\n`;

describe('communicationStyleSave', () => {
  it('reads --from and saves into custom/<name>.md', () => {
    const from = writeDraft('my-style', styleText('my-style'));
    const result = communicationStyleSave({ catalogRoot, name: 'my-style', from });
    expect(result).toEqual({ path: 'custom/my-style.md', overwritten: false });
    expect(fs.existsSync(path.join(catalogRoot, 'custom', 'my-style.md'))).toBe(true);
  });

  it('throws UserError when --from does not exist', () => {
    expect(() => communicationStyleSave({ catalogRoot, name: 'my-style', from: path.join(draftsDir, 'missing.md') }))
      .toThrow(UserError);
  });

  it('throws UserError when the draft fails parsing', () => {
    const from = writeDraft('my-style', 'not frontmatter at all');
    expect(() => communicationStyleSave({ catalogRoot, name: 'my-style', from })).toThrow(UserError);
  });

  it('throws UserError for a name that escapes the custom folder', () => {
    const from = writeDraft('evil', styleText('evil'));
    expect(() => communicationStyleSave({ catalogRoot, name: '../evil', from })).toThrow(UserError);
  });
});
