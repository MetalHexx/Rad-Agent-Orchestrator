import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withHomedir } from '@/lib/test-helpers';

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xde, 0xad, 0xbe, 0xef]);

function req(pathParam?: string): import('next/server').NextRequest {
  const url = new URL('http://localhost/api/docs/asset');
  if (pathParam !== undefined) url.searchParams.set('path', pathParam);
  return { nextUrl: url } as unknown as import('next/server').NextRequest;
}

/** A stubbed homedir whose ~/.radorc/docs holds one seeded asset under assets/,
 *  plus a same-named .png sitting outside assets/ to prove that alone isn't enough. */
function buildFixture(): string {
  const home = mkdtempSync(join(tmpdir(), 'docs-asset-'));
  const docsRoot = join(home, '.radorc', 'docs');
  mkdirSync(join(docsRoot, 'assets'), { recursive: true });
  writeFileSync(join(docsRoot, 'assets', 'dashboard-screenshot.png'), PNG_BYTES);
  writeFileSync(join(docsRoot, 'evil.png'), PNG_BYTES);
  return home;
}

test('GET ?path=assets/dashboard-screenshot.png returns the PNG bytes with an image content type', async () => {
  const home = buildFixture();
  await withHomedir(home, async () => {
    const { GET } = await import('./route');
    const res = await GET(req('assets/dashboard-screenshot.png'));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
    const bytes = Buffer.from(await res.arrayBuffer());
    assert.ok(bytes.equals(PNG_BYTES));
  });
});

test('GET ?path=<missing asset> returns 404', async () => {
  const home = buildFixture();
  await withHomedir(home, async () => {
    const { GET } = await import('./route');
    const res = await GET(req('assets/does-not-exist.png'));
    assert.equal(res.status, 404);
  });
});

test('GET ?path=<non-.png> returns 400', async () => {
  const home = buildFixture();
  await withHomedir(home, async () => {
    const { GET } = await import('./route');
    const res = await GET(req('docs/pipeline.md'));
    assert.equal(res.status, 400);
  });
});

test('GET ?path=<.png outside assets/> returns 400 even though the extension is correct', async () => {
  const home = buildFixture();
  await withHomedir(home, async () => {
    const { GET } = await import('./route');
    const res = await GET(req('evil.png'));
    assert.equal(res.status, 400);
  });
});

test('GET ?path=assets/../evil.png returns 400 — resolves outside assets/ once the climb collapses', async () => {
  const home = buildFixture();
  await withHomedir(home, async () => {
    const { GET } = await import('./route');
    const res = await GET(req('assets/../evil.png'));
    assert.equal(res.status, 400);
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
    });
  });
}
