import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withHomedir } from '@/lib/test-helpers';

const README_CONTENT = '# Corpus README\n\nWelcome to the fixture corpus.\n';
const PIPELINE_CONTENT = '# Pipeline\n\nFixture pipeline page.\n';

function req(pathParam?: string): import('next/server').NextRequest {
  const url = new URL('http://localhost/api/docs/content');
  if (pathParam !== undefined) url.searchParams.set('path', pathParam);
  return { nextUrl: url } as unknown as import('next/server').NextRequest;
}

/** A stubbed homedir whose ~/.radorc/docs holds a README and a nested docs page. */
function buildFixture(): string {
  const home = mkdtempSync(join(tmpdir(), 'docs-content-'));
  const docsRoot = join(home, '.radorc', 'docs');
  mkdirSync(join(docsRoot, 'docs'), { recursive: true });
  writeFileSync(join(docsRoot, 'README.md'), README_CONTENT);
  writeFileSync(join(docsRoot, 'docs', 'pipeline.md'), PIPELINE_CONTENT);
  return home;
}

test('GET with no path returns the corpus README content', async () => {
  const home = buildFixture();
  await withHomedir(home, async () => {
    const { GET } = await import('./route');
    const res = await GET(req());
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.content.includes('Welcome to the fixture corpus.'));
    assert.deepEqual(body.frontmatter, {});
    assert.ok(body.filePath.endsWith('README.md'));
  });
});

test('GET ?path=docs/pipeline.md returns that page', async () => {
  const home = buildFixture();
  await withHomedir(home, async () => {
    const { GET } = await import('./route');
    const res = await GET(req('docs/pipeline.md'));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.content.includes('Fixture pipeline page.'));
  });
});

test('GET ?path=<absent page> returns 404', async () => {
  const home = buildFixture();
  await withHomedir(home, async () => {
    const { GET } = await import('./route');
    const res = await GET(req('docs/does-not-exist.md'));
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, 'Document not found');
  });
});

const TRAVERSAL_SHAPES = ['../../.ssh/id_rsa', '/etc/passwd', 'C:\\Windows\\win.ini', 'docs/../../secrets.md'];

for (const shape of TRAVERSAL_SHAPES) {
  test(`GET ?path=${shape} is rejected (4xx), never serving anything outside the corpus`, async () => {
    const home = buildFixture();
    await withHomedir(home, async () => {
      const { GET } = await import('./route');
      const res = await GET(req(shape));
      assert.ok(res.status >= 400 && res.status < 500, `expected 4xx, got ${res.status}`);
      const body = await res.json();
      assert.equal(typeof body.error, 'string');
    });
  });
}
