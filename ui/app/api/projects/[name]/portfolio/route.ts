import { NextResponse } from 'next/server';

import { detectPortfolio } from '@/lib/portfolio-detect';

export const dynamic = 'force-dynamic';

const PROJECT_NAME_PATTERN = /^[A-Z0-9][A-Z0-9._-]*$/;

/** GET /api/projects/[name]/portfolio — response shape. */
export interface ProjectPortfolioResponse {
  /** The portfolio this project belongs to, or null for non-membership. */
  portfolio: { name: string } | null;
}

/**
 * Reports whether a project belongs to a portfolio, WITHOUT approving anything.
 *
 * This exists so the approval wizard can decide up front whether it owes the
 * operator a debrief question. The gate route also reports membership, but only
 * in its POST response — by which point the approval has already landed and the
 * pipeline state change is already racing the dialog that would ask. Reading it
 * ahead of the commit is what lets every question be answered before any server
 * state moves.
 *
 * `detectPortfolio` never throws and collapses failure into the same `null` as
 * genuine non-membership, so this route cannot distinguish them either — and
 * must not try. A null here only ever costs the operator the debrief question,
 * which the portfolio's own surfaces can still offer later; it can never affect
 * an approval, because this route approves nothing.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> | { name: string } }
): Promise<NextResponse<ProjectPortfolioResponse | { error: string }>> {
  const resolvedParams = params instanceof Promise ? await params : params;
  const name = resolvedParams.name;

  if (!PROJECT_NAME_PATTERN.test(name)) {
    return NextResponse.json({ error: 'Invalid project name format.' }, { status: 400 });
  }

  const detected = await detectPortfolio(name);
  return NextResponse.json(
    { portfolio: detected ? { name: detected.name } : null } satisfies ProjectPortfolioResponse,
    { status: 200 },
  );
}
