import { spawn as nodeSpawn } from 'node:child_process';
import { buildClaudeCommand } from './claude-command';
import { buildChildEnv } from './child-env';

// Loose structural shape of child_process.spawn so a fake can be injected in tests.
// windowsHide keeps the cmd.exe wrapper (needed because `claude` is a .cmd shim)
// from flashing a visible console window on every turn.
export type SpawnLike = (
  command: string,
  options: { shell: boolean; cwd: string; env: NodeJS.ProcessEnv; windowsHide?: boolean },
) => {
  stdin: { write: (chunk: string) => void; end: () => void };
  stdout: { on: (event: 'data', listener: (chunk: Buffer | string) => void) => void };
  stderr: { on: (event: 'data', listener: (chunk: Buffer | string) => void) => void };
  on: (event: 'close' | 'error', listener: (arg: number | Error | null) => void) => void;
};

export interface RunDeps {
  env: NodeJS.ProcessEnv;
  cwd: string;
  spawnFn?: SpawnLike;
}

export interface TurnInput {
  message: string;
  sessionId: string;
  resume: boolean;
}

// Spawn one Claude turn. The client owns the session id and decides create-vs-resume
// via `resume` (resume=false -> --session-id creates it on turn 1; resume=true ->
// --resume continues it), so the server holds no session state. The message is fed
// via stdin (no shell escaping); shell:true is required because `claude` is a .cmd
// shim on Windows; the API key is stripped so the cached OAuth is used (AD-1..AD-4).
export function runClaudeTurn(
  input: TurnInput,
  deps: RunDeps,
): Promise<{ reply: string; sessionId: string }> {
  const spawnFn = deps.spawnFn ?? (nodeSpawn as unknown as SpawnLike);
  const isFirstTurn = !input.resume;
  const command = buildClaudeCommand({ sessionId: input.sessionId, isFirstTurn });
  const env = buildChildEnv(deps.env);

  return new Promise((resolve, reject) => {
    const child = spawnFn(command, { shell: true, cwd: deps.cwd, env, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (err) => reject(err instanceof Error ? err : new Error(String(err))));
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`claude exited with code ${code}: ${stderr.trim()}`));
        return;
      }
      let parsed: { result?: string; session_id?: string };
      try {
        parsed = JSON.parse(stdout);
      } catch {
        reject(new Error(`Could not parse Claude JSON output: ${stdout.slice(0, 200)}`));
        return;
      }
      resolve({ reply: parsed.result ?? '', sessionId: parsed.session_id ?? input.sessionId });
    });
    child.stdin.write(input.message);
    child.stdin.end();
  });
}
