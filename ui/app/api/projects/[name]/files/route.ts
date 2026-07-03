import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

import path from 'node:path';
import { resolveProjectDir } from '@/lib/path-resolver';
import { listProjectFilesWithMtimes, readDocument, fileExists } from '@/lib/fs-reader';
import { parseDocument } from '@/lib/markdown-parser';

/**
 * Read `${project}-REQUIREMENTS.md`'s frontmatter `status` (lowercased/trimmed).
 * Reads only this one file — never the full doc set — so this stays cheap on
 * every files-list poll. Returns null when the doc or the field is absent.
 */
async function readRequirementsStatus(projectDir: string, projectName: string): Promise<string | null> {
  const reqPath = path.join(projectDir, `${projectName}-REQUIREMENTS.md`);
  if (!(await fileExists(reqPath))) return null;
  const raw = await readDocument(reqPath);
  const { frontmatter } = parseDocument(raw);
  const status = frontmatter.status;
  return typeof status === 'string' && status.trim() !== '' ? status.trim().toLowerCase() : null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: { name: string } }
) {
  try {
    const projectDir = resolveProjectDir(params.name);
    const { files, mtimes } = await listProjectFilesWithMtimes(projectDir);
    const requirementsStatus = await readRequirementsStatus(projectDir, params.name);

    return NextResponse.json({ files, mtimes, requirementsStatus }, { status: 200 });
  } catch (err) {
    const isNotFound =
      err instanceof Error &&
      'code' in err &&
      (err as NodeJS.ErrnoException).code === 'ENOENT';

    if (isNotFound) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
