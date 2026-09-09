import { NextResponse } from 'next/server';
import { listStyleCatalog, resolveStyleCatalogRoot } from '@/lib/communication-styles-fs';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const styles = listStyleCatalog(resolveStyleCatalogRoot());
    return NextResponse.json({ styles }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
