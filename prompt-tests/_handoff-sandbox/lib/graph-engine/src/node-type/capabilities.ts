import type { NodeId } from '../model/node.js';
import type { AgentSpawnRequest, Envelope, ReviewSpawnRequest } from './definition.js';

/**
 * Carried on every outward-reaching capability call — never on a pure read — so a host re-running
 * an attempt recognizes the key it already served and returns the prior envelope instead of
 * re-firing the external effect. `originatingNodeId` is the node whose `act`/`handle` cycle
 * issued the call; `idempotencyKey` is stable across a retried attempt of that same call.
 */
export interface IdempotentCallContext {
  readonly originatingNodeId: NodeId;
  readonly idempotencyKey: string;
}

// ── doc-read ─────────────────────────────────────────────────────────────────────
export interface DocReadRequest {
  readonly path: string;
}

/** A read — naturally idempotent, so it carries no `IdempotentCallContext`. */
export interface DocReadPort {
  read(request: DocReadRequest): Promise<Envelope<{ readonly content: string }>>;
}

// ── doc-write ────────────────────────────────────────────────────────────────────
export interface DocWriteRequest extends IdempotentCallContext {
  readonly path: string;
  readonly content: string;
}

export interface DocWriteResult {
  readonly idempotencyKey: string;
  readonly path: string;
}

export interface DocWritePort {
  write(request: DocWriteRequest): Promise<Envelope<DocWriteResult>>;
}

// ── git-facts ────────────────────────────────────────────────────────────────────
export interface GitFactsRequest {
  readonly repoPath: string;
}

export interface GitFacts {
  readonly branch: string;
  readonly headSha: string;
  readonly isClean: boolean;
  readonly remoteUrl?: string;
}

/** A read — naturally idempotent, so it carries no `IdempotentCallContext`. */
export interface GitFactsPort {
  facts(request: GitFactsRequest): Promise<Envelope<GitFacts>>;
}

// ── spawn-agent ──────────────────────────────────────────────────────────────────
export interface SpawnAgentRequest extends IdempotentCallContext {
  readonly request: AgentSpawnRequest | ReviewSpawnRequest;
}

export interface SpawnAgentResult {
  readonly idempotencyKey: string;
  readonly spawned: boolean;
}

export interface SpawnAgentPort {
  spawn(request: SpawnAgentRequest): Promise<Envelope<SpawnAgentResult>>;
}

// ── run-command ──────────────────────────────────────────────────────────────────
export interface RunCommandRequest extends IdempotentCallContext {
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
}

export interface RunCommandResult {
  readonly idempotencyKey: string;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface RunCommandPort {
  run(request: RunCommandRequest): Promise<Envelope<RunCommandResult>>;
}

// ── request-human ────────────────────────────────────────────────────────────────
export interface RequestHumanRequest extends IdempotentCallContext {
  readonly prompt: string;
}

export interface RequestHumanResult {
  readonly idempotencyKey: string;
  readonly response: string;
}

export interface RequestHumanPort {
  request(request: RequestHumanRequest): Promise<Envelope<RequestHumanResult>>;
}

// ── code-behind port ─────────────────────────────────────────────────────────────
/**
 * The one narrow code-behind slot: a node-type-shipped pure function, invoked through the same
 * port mechanism as a host-implemented capability, that turns raw external input into parsed
 * values. Its signature is exactly `(input) => Envelope` — no parameter carries a store, a scope,
 * or a graph snapshot, so it is structurally incapable of mutating the graph, touching the store,
 * or deciding routing structure; it can only compute and hand back values. Not a member of the
 * closed `CapabilityName` vocabulary — a node type names its own code-behind capability through
 * that vocabulary's open `(string & {})` escape hatch.
 */
export type CodeBehindPort<TInput = unknown, TData = Readonly<Record<string, unknown>>> = (
  input: TInput,
) => Envelope<TData>;
