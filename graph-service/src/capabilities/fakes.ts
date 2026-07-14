// graph-service/src/capabilities/fakes.ts
//
// Hand-rolled fakes for the engine's six capability ports — the `CapabilityPorts` seam a real
// implementation (process spawn, git, filesystem, an actual human prompt) drops into unchanged.
// Every fake returns a canned `Envelope` and echoes the caller's own `idempotencyKey`; none ever
// touches real git/process/network. Ported from `lib/graph-node-types/tests/harness/
// test-driver.ts`'s proven `createFakedCapabilityPorts` — same classes, same names, adapted only
// to this package's barrel-only import convention.
import type {
  DocReadPort,
  DocReadRequest,
  DocWritePort,
  DocWriteRequest,
  DocWriteResult,
  Envelope,
  GitFacts,
  GitFactsPort,
  GitFactsRequest,
  RequestHumanPort,
  RequestHumanRequest,
  RequestHumanResult,
  RunCommandPort,
  RunCommandRequest,
  RunCommandResult,
  SpawnAgentPort,
  SpawnAgentRequest,
  SpawnAgentResult,
} from '@rad-orchestration/graph-engine';

export class FakeDocReadPort implements DocReadPort {
  private readonly docs = new Map<string, string>();

  /** Pre-loads the canned content a later `read` for `path` returns. */
  seed(path: string, content: string): void {
    this.docs.set(path, content);
  }

  async read(request: DocReadRequest): Promise<Envelope<{ readonly content: string }>> {
    const content = this.docs.get(request.path);
    if (content === undefined) return { outcome: 'error', data: { content: '' } };
    return { outcome: 'ok', data: { content } };
  }
}

export class FakeDocWritePort implements DocWritePort {
  readonly writes: DocWriteRequest[] = [];

  async write(request: DocWriteRequest): Promise<Envelope<DocWriteResult>> {
    this.writes.push(request);
    return { outcome: 'ok', data: { idempotencyKey: request.idempotencyKey, path: request.path } };
  }
}

export class FakeGitFactsPort implements GitFactsPort {
  constructor(private readonly canned: GitFacts = { branch: 'main', headSha: 'a1b2c3d', isClean: true }) {}

  async facts(_request: GitFactsRequest): Promise<Envelope<GitFacts>> {
    return { outcome: 'ok', data: this.canned };
  }
}

export class FakeSpawnAgentPort implements SpawnAgentPort {
  readonly spawned: SpawnAgentRequest[] = [];

  async spawn(request: SpawnAgentRequest): Promise<Envelope<SpawnAgentResult>> {
    this.spawned.push(request);
    return { outcome: 'ok', data: { idempotencyKey: request.idempotencyKey, spawned: true } };
  }
}

export class FakeRunCommandPort implements RunCommandPort {
  readonly ran: RunCommandRequest[] = [];

  async run(request: RunCommandRequest): Promise<Envelope<RunCommandResult>> {
    this.ran.push(request);
    return { outcome: 'ok', data: { idempotencyKey: request.idempotencyKey, exitCode: 0, stdout: '', stderr: '' } };
  }
}

export class FakeRequestHumanPort implements RequestHumanPort {
  private readonly responses = new Map<string, string>();

  /** Pre-loads the canned response a later `request` for `idempotencyKey` returns. */
  seed(idempotencyKey: string, response: string): void {
    this.responses.set(idempotencyKey, response);
  }

  async request(request: RequestHumanRequest): Promise<Envelope<RequestHumanResult>> {
    const response = this.responses.get(request.idempotencyKey) ?? 'granted';
    return { outcome: 'ok', data: { idempotencyKey: request.idempotencyKey, response } };
  }
}

export interface FakedCapabilityPorts {
  readonly docRead: FakeDocReadPort;
  readonly docWrite: FakeDocWritePort;
  readonly gitFacts: FakeGitFactsPort;
  readonly spawnAgent: FakeSpawnAgentPort;
  readonly runCommand: FakeRunCommandPort;
  readonly requestHuman: FakeRequestHumanPort;
}

export function createFakedCapabilityPorts(): FakedCapabilityPorts {
  return {
    docRead: new FakeDocReadPort(),
    docWrite: new FakeDocWritePort(),
    gitFacts: new FakeGitFactsPort(),
    spawnAgent: new FakeSpawnAgentPort(),
    runCommand: new FakeRunCommandPort(),
    requestHuman: new FakeRequestHumanPort(),
  };
}
