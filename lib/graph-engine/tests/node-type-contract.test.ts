import { describe, expect, it } from 'vitest';
import { DATA_FIELD_KINDS, DATA_FIELD_LEVELS, ENVELOPE_OUTCOMES } from '../src/index.js';
import type {
  ActContext,
  ActResult,
  CodeBehindPort,
  DataSchema,
  DocWriteRequest,
  Envelope,
  HandleResult,
  IdempotentCallContext,
  NodeEvent,
  NodeStatus,
  NodeTypeDefinition,
  RunCommandRequest,
  SpawnAgentRequest,
} from '../src/index.js';

const dataSchema: DataSchema = {
  attempt: { kind: 'number', level: 'computed', description: 'retry count the node tracks itself' },
  targetPath: { kind: 'string', level: 'optional', description: 'template-authored, opt-in path' },
};

/** A minimal in-test node type exercising every hook of the contract end to end. */
function makeFakeNodeType(): NodeTypeDefinition {
  return {
    name: 'test:fake',
    dataSchema,
    traits: [],
    capabilities: ['doc-read'],
    presentation: { label: 'Fake' },
    instructions: '# Fake node type\n\nDoes nothing.',
    act(ctx: ActContext): ActResult {
      return { instructions: `run for ${ctx.nodeId}`, executor: 'noop' };
    },
    handle(ev: NodeEvent): HandleResult {
      if (ev.envelope.outcome === 'error') {
        return { routing: { primitive: 'reset', params: { node: ev.nodeId } } };
      }
      return { dataChange: { lastRoute: ev.envelope.route ?? null } };
    },
    projectStatus(data): NodeStatus {
      return typeof data.attempt === 'number' && data.attempt > 0 ? 'in_progress' : 'not_started';
    },
  };
}

describe('NodeTypeDefinition contract shape', () => {
  it('declares traits/capabilities/dataSchema against the closed vocabularies', () => {
    const fake = makeFakeNodeType();
    expect(fake.traits).toEqual([]);
    expect(fake.capabilities).toEqual(['doc-read']);
    expect(DATA_FIELD_KINDS).toContain(dataSchema.attempt.kind);
    expect(DATA_FIELD_LEVELS).toContain(dataSchema.attempt.level);
  });

  it('act returns an ActResult naming the requested executor', () => {
    const result = makeFakeNodeType().act({ nodeId: 'n1', data: {} });
    expect(result.executor).toBe('noop');
    expect(result.instructions).toContain('n1');
  });

  it('handle reads the output envelope spine and reacts to outcome/route, never the raw graph', () => {
    const fake = makeFakeNodeType();

    const ok: Envelope = { outcome: 'ok', data: {}, route: 'test:fake.completed' };
    const okResult = fake.handle({ token: 'test:fake.completed', nodeId: 'n1', envelope: ok });
    expect(okResult.dataChange).toEqual({ lastRoute: 'test:fake.completed' });
    expect(okResult.routing).toBeUndefined();

    const failed: Envelope = { outcome: 'error', data: {} };
    expect(ENVELOPE_OUTCOMES).toContain(failed.outcome);
    const failedResult = fake.handle({ token: 'test:fake.failed', nodeId: 'n1', envelope: failed });
    expect(failedResult.routing).toEqual({ primitive: 'reset', params: { node: 'n1' } });
  });

  it('projectStatus reads node data into the core-legible status spine', () => {
    const fake = makeFakeNodeType();
    expect(fake.projectStatus({})).toBe('not_started');
    expect(fake.projectStatus({ attempt: 1 })).toBe('in_progress');
  });
});

describe('code-behind port', () => {
  it('is a plain (input) => Envelope function with no store/graph parameter available to it', () => {
    const parseAttempt: CodeBehindPort<{ raw: string }, { attempt: number }> = (input) => {
      const attempt = Number.parseInt(input.raw, 10);
      return { outcome: Number.isNaN(attempt) ? 'error' : 'ok', data: { attempt } };
    };

    const result = parseAttempt({ raw: '3' });
    expect(result.outcome).toBe('ok');
    expect(result.data.attempt).toBe(3);
  });
});

describe('capability-port idempotency contract', () => {
  it('outward-reaching requests carry an originating node id and idempotency key', () => {
    const idempotency: IdempotentCallContext = { originatingNodeId: 'n1', idempotencyKey: 'n1:attempt-1' };
    const runCommand: RunCommandRequest = { ...idempotency, command: 'echo hi' };
    const docWrite: DocWriteRequest = { ...idempotency, path: '/tmp/out.md', content: 'hi' };
    const spawnAgent: SpawnAgentRequest = {
      ...idempotency,
      request: {
        kind: 'coder',
        handoffDoc: '/tmp/handoff.md',
        complexity: 'standard',
        repos: [],
        shouldCommit: true,
      },
    };

    expect(runCommand.originatingNodeId).toBe('n1');
    expect(docWrite.idempotencyKey).toBe('n1:attempt-1');
    expect(spawnAgent.request.kind).toBe('coder');
  });
});
