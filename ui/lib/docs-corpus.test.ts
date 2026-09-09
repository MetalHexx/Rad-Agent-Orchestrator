import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { withHomedir } from '@/lib/test-helpers';

function buildHome(): string {
  return mkdtempSync(path.join(tmpdir(), 'docs-corpus-'));
}

test('resolveCorpusPath resolves the README at the corpus root', async () => {
  const home = buildHome();
  await withHomedir(home, async () => {
    const { resolveCorpusPath } = await import('./docs-corpus');
    const { getDocsRoot } = await import('./path-resolver');
    assert.equal(resolveCorpusPath('README.md'), path.join(getDocsRoot(), 'README.md'));
  });
});

test('resolveCorpusPath resolves a nested docs page', async () => {
  const home = buildHome();
  await withHomedir(home, async () => {
    const { resolveCorpusPath } = await import('./docs-corpus');
    const { getDocsRoot } = await import('./path-resolver');
    assert.equal(
      resolveCorpusPath('docs/pipeline.md'),
      path.join(getDocsRoot(), 'docs', 'pipeline.md'),
    );
  });
});

test('resolveCorpusPath normalizes backslashes the same as forward slashes', async () => {
  const home = buildHome();
  await withHomedir(home, async () => {
    const { resolveCorpusPath } = await import('./docs-corpus');
    assert.equal(resolveCorpusPath('docs\\pipeline.md'), resolveCorpusPath('docs/pipeline.md'));
  });
});

test('resolveCorpusPath strips a leading slash rather than treating it as filesystem-root', async () => {
  const home = buildHome();
  await withHomedir(home, async () => {
    const { resolveCorpusPath } = await import('./docs-corpus');
    assert.equal(resolveCorpusPath('/docs/pipeline.md'), resolveCorpusPath('docs/pipeline.md'));
  });
});

test('resolveCorpusPath rejects a relative ../ climb out of the corpus', async () => {
  const home = buildHome();
  await withHomedir(home, async () => {
    const { resolveCorpusPath } = await import('./docs-corpus');
    assert.equal(resolveCorpusPath('../../.ssh/id_rsa'), null);
  });
});

test('resolveCorpusPath rejects a climb that dips back out after descending', async () => {
  const home = buildHome();
  await withHomedir(home, async () => {
    const { resolveCorpusPath } = await import('./docs-corpus');
    assert.equal(resolveCorpusPath('docs/../../secrets.md'), null);
  });
});

test('resolveCorpusPath rejects a foreign Windows drive-letter path', async () => {
  const home = buildHome();
  await withHomedir(home, async () => {
    const { resolveCorpusPath } = await import('./docs-corpus');
    assert.equal(resolveCorpusPath('C:\\Windows\\win.ini'), null);
  });
});

test('resolveCorpusPath never escapes the corpus for an absolute-looking posix path', async () => {
  const home = buildHome();
  await withHomedir(home, async () => {
    const { resolveCorpusPath } = await import('./docs-corpus');
    const { getDocsRoot } = await import('./path-resolver');
    const resolved = resolveCorpusPath('/etc/passwd');
    // The leading slash is stripped rather than honored, so this can only ever
    // land inside the corpus (and, since no such file is seeded, 404s there) —
    // it must never point at the real /etc/passwd.
    if (resolved !== null) {
      assert.equal(path.relative(getDocsRoot(), resolved).startsWith('..'), false);
    }
  });
});
