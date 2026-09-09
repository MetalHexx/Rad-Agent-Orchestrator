import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import { getDocsRoot } from '@/lib/path-resolver';
import { isContainedIn, resolveCorpusPath } from '@/lib/docs-corpus';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const pathParam = request.nextUrl.searchParams.get('path') ?? '';

  if (!pathParam.endsWith('.png')) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  const absPath = resolveCorpusPath(pathParam);
  if (!absPath) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  const assetsRoot = path.join(getDocsRoot(), 'assets');
  if (!isContainedIn(assetsRoot, absPath)) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  try {
    // lgtm[js/path-injection] absPath is validated by resolveCorpusPath() and a second
    // isContainedIn(assetsRoot, ...) check above before this read; both use the
    // path.relative-based containment idiom, which CodeQL's taint tracker does not
    // model as a sanitizer. See docs-corpus.test.ts for the traversal-rejection tests.
    const bytes = await readFile(absPath);
    return new NextResponse(bytes, {
      status: 200,
      headers: { 'content-type': 'image/png' },
    });
  } catch (err) {
    const isNotFound =
      err instanceof Error &&
      'code' in err &&
      (err as NodeJS.ErrnoException).code === 'ENOENT';

    if (isNotFound) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
