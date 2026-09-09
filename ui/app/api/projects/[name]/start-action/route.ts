import { NextRequest, NextResponse } from 'next/server';

import { discoverProjects } from '@/lib/fs-reader';
import os from 'node:os';
import path from 'node:path';
import { launchTerminal } from '@rad-orchestration/terminal-launch';

export const dynamic = 'force-dynamic';

const PROJECT_NAME_PATTERN = /^[A-Z0-9][A-Z0-9._-]*$/;

type StartAction = 'start-planning' | 'start-brainstorming' | 'execute-plan';
const ALLOWED_ACTIONS: ReadonlySet<StartAction> = new Set<StartAction>([
  'start-planning',
  'start-brainstorming',
  'execute-plan',
]);

/**
 * Server-side prompt composition. The literal strings live here — not in
 * the browser — so a modified client cannot launch Claude with arbitrary
 * slash commands. (AD-4)
 */
function composePrompt(action: StartAction, projectName: string): string {
  if (action === 'start-planning') {
    return `/rad-plan Start planning ${projectName}`;
  }
  if (action === 'execute-plan') {
    // Literal slash-prefixed prompt invokes the /rad-execute skill with the
    // validated project name. Composed server-side so a modified client
    // cannot launch an arbitrary slash command.
    return `/rad-execute ${projectName}`;
  }
  return `/rad-brainstorm ${projectName}`;
}

export async function POST(
  request: NextRequest,
  { params }: { params: { name: string } }
): Promise<NextResponse> {
  // 1. Validate project name format (AD-5)
  const name = params.name;
  if (!PROJECT_NAME_PATTERN.test(name)) {
    return NextResponse.json({ error: 'Invalid project name format.' }, { status: 400 });
  }

  // 2. Parse body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  const action = (body as { action?: string } | null)?.action;
  function isAllowedAction(a: string | undefined): a is StartAction {
    return a !== undefined && (ALLOWED_ACTIONS as ReadonlySet<string>).has(a);
  }
  if (!isAllowedAction(action)) {
    return NextResponse.json(
      { error: 'Invalid action. Allowed: start-planning, start-brainstorming, execute-plan.' },
      { status: 400 }
    );
  }

  // 3. Validate project exists under ~/.radorc/projects/ (AD-5)
  let projectExists = false;
  try {
    const projects = await discoverProjects();
    projectExists = projects.some((p) => p.name === name);
  } catch {
    return NextResponse.json(
      { error: 'Failed to enumerate projects.' },
      { status: 500 }
    );
  }
  if (!projectExists) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
  }

  // 4. Compose prompt server-side and invoke launcher (FR-4, FR-5, AD-3, AD-4)
  const prompt = composePrompt(action, name);
  const result = launchTerminal({
    agent: 'claude',
    cwd: path.join(os.homedir(), '.radorc'),
    prompt,
    permissionMode: 'auto',
  });

  if (!result.ok) {
    // Do not echo absolute paths or env values. The shared launcher's cwd
    // check reports "Launch directory no longer exists: <cwd>" — the only
    // one of its error shapes that carries this route's cwd — so that one
    // is replaced with a path-free equivalent; every other launcher error
    // (a missing terminal binary, a spawn failure) never mentions cwd.
    const message = result.error?.startsWith('Launch directory no longer exists')
      ? 'Launch directory no longer exists.'
      : result.error ?? 'Launcher failed.';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }

  return NextResponse.json(
    { success: true, platform: result.platform },
    { status: 200 }
  );
}
