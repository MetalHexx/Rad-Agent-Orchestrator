import { NextRequest, NextResponse } from 'next/server';

import { resolveAndValidateFolder, openFolder } from '@/lib/open-folder';

export const dynamic = 'force-dynamic';

const PROJECT_NAME_PATTERN = /^[A-Z0-9][A-Z0-9._-]*$/;

/**
 * SC-PANEL-POLISH: reveal a repo's folder in the OS file explorer.
 *
 * The dashboard server runs locally, so it can open a host file manager.
 * The requested path is validated against the known `~/.radorc` roots
 * (see `resolveAndValidateFolder`) before anything is spawned — a modified
 * client cannot induce opening an arbitrary path.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { name: string } }
): Promise<NextResponse> {
  // 1. Validate project name format (consistency with the other project routes).
  if (!PROJECT_NAME_PATTERN.test(params.name)) {
    return NextResponse.json({ error: 'Invalid project name format.' }, { status: 400 });
  }

  // 2. Parse body.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  const rawPath = (body as { path?: unknown } | null)?.path;

  // 3. Validate + resolve the path against the allowed roots.
  const resolved = resolveAndValidateFolder(rawPath);
  if ('error' in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: 400 });
  }

  // 4. Open it. Never echo absolute paths in the error (match start-action/gate).
  const result = await openFolder(resolved.absPath);
  if (!result.success) {
    return NextResponse.json(
      { success: false, error: result.error ?? 'Failed to open folder.' },
      { status: 500 }
    );
  }
  return NextResponse.json({ success: true }, { status: 200 });
}
