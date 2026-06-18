import { spawn as nodeSpawn } from 'node:child_process';
import { resolveTurn, type SessionStoreApi } from './session-logic';
import { buildClaudeCommand } from './claude-command';
import { buildChildEnv } from './child-env';

// Loose structural shape of child_process.spawn so a fake can be injected in tests.
export type SpawnLike = (
  command: string,
  options: { shell: boolean; cwd: string; env: NodeJS.ProcessEnv },
) => {
  stdin: { write: (chunk: string) => void; end: () => void };
  stdout: { on: (event: 'data', listener: (chunk: Buffer | string) => void) => void };
  stderr: { on: (event: 'data', listener: (chunk: Buffer | string) => void) => void };
  on: (event: 'close' | 'error', listener: (arg: number | Error | null) => void) => void;
};

export interface RunDeps {
  env: NodeJS.ProcessEnv;
  cwd: string;
  store: SessionStoreApi;
  mint: () => string;
  spawnFn?: SpawnLike;
}

export interface TurnInput {
  message: string;
  clientSessionId?: string;
}

// Spawn one Claude turn: build the command, strip the API key, feed the message
// via stdin (shell: true is required because `claude` is a .cmd shim on Windows),
// collect stdout, parse the JSON `result`, and update the session store (AD-1, AD-2, AD-4).
export function runClaudeTurn(
  input: TurnInput,
  deps: RunDeps,
): Promise<{ reply: string; sessionId: string }> {
  const spawnFn = deps.spawnFn ?? (nodeSpawn as unknown as SpawnLike);
  const { sessionId, isFirstTurn } = resolveTurn(deps.store.getState(), input.clientSessionId, deps.mint);
  const command = buildClaudeCommand({ sessionId, isFirstTurn });
  const env = buildChildEnv(deps.env);

  return new Promise((resolve, reject) => {
    const child = spawnFn(command, { shell: true, cwd: deps.cwd, env });
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
      const established = parsed.session_id ?? sessionId;
      deps.store.setState({ sessionId: established, established: true });
      resolve({ reply: parsed.result ?? '', sessionId: established });
    });
    child.stdin.write(input.message);
    child.stdin.end();
  });
}
