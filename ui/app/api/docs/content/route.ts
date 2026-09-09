import { readFile } from 'node:fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import { resolveCorpusPath } from '@/lib/docs-corpus';
import { parseDocument } from '@/lib/markdown-parser';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const pathParam = request.nextUrl.searchParams.get('path') || 'README.md';

  if (!pathParam.endsWith('.md')) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  const absPath = resolveCorpusPath(pathParam);
  if (!absPath) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  try {
    // lgtm[js/path-injection] absPath is validated by resolveCorpusPath() above before
    // this read, using the path.relative-based containment idiom (docs-corpus.ts),
    // which CodeQL's taint tracker does not model as a sanitizer. See
    // docs-corpus.test.ts for the traversal-rejection tests.
    const raw = await readFile(absPath, 'utf-8');
    const { frontmatter, content } = parseDocument(raw);
    return NextResponse.json({ frontmatter, content, filePath: absPath }, { status: 200 });
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
