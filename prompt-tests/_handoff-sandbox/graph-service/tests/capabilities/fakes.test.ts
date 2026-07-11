import { describe, expect, it } from 'vitest';
import { createFakedCapabilityPorts } from '../../src/capabilities/fakes.js';

describe('createFakedCapabilityPorts', () => {
  it('builds all six ports', () => {
    const ports = createFakedCapabilityPorts();
    expect(ports.docRead).toBeDefined();
    expect(ports.docWrite).toBeDefined();
    expect(ports.gitFacts).toBeDefined();
    expect(ports.spawnAgent).toBeDefined();
    expect(ports.runCommand).toBeDefined();
    expect(ports.requestHuman).toBeDefined();
  });
});

describe('FakeDocReadPort', () => {
  it('errors on an unseeded path and returns canned content once seeded', async () => {
    const { docRead } = createFakedCapabilityPorts();

    const missed = await docRead.read({ path: 'docs/plan.md' });
    expect(missed.outcome).toBe('error');

    docRead.seed('docs/plan.md', '# Plan');
    const hit = await docRead.read({ path: 'docs/plan.md' });
    expect(hit).toEqual({ outcome: 'ok', data: { content: '# Plan' } });
  });
});

describe('FakeDocWritePort', () => {
  it('records every write and echoes the idempotency key and path back', async () => {
    const { docWrite } = createFakedCapabilityPorts();

    const result = await docWrite.write({
      originatingNodeId: 'node-1',
      idempotencyKey: 'node-1:write',
      path: 'docs/out.md',
      content: 'hello',
    });

    expect(result).toEqual({ outcome: 'ok', data: { idempotencyKey: 'node-1:write', path: 'docs/out.md' } });
    expect(docWrite.writes).toHaveLength(1);
    expect(docWrite.writes[0].content).toBe('hello');
  });
});

describe('FakeGitFactsPort', () => {
  it('returns the default canned facts, or a constructor-supplied override', async () => {
    const defaults = await createFakedCapabilityPorts().gitFacts.facts({ repoPath: '/repos/a' });
    expect(defaults).toEqual({ outcome: 'ok', data: { branch: 'main', headSha: 'a1b2c3d', isClean: true } });

    const { FakeGitFactsPort } = await import('../../src/capabilities/fakes.js');
    const custom = new FakeGitFactsPort({ branch: 'feature/x', headSha: 'deadbee', isClean: false });
    const result = await custom.facts({ repoPath: '/repos/a' });
    expect(result.data).toEqual({ branch: 'feature/x', headSha: 'deadbee', isClean: false });
  });
});

describe('FakeSpawnAgentPort', () => {
  it('records every spawn and never touches a real process', async () => {
    const { spawnAgent } = createFakedCapabilityPorts();
    const request = {
      kind: 'coder' as const,
      handoffDoc: '/tasks/t.md',
      complexity: 'simple' as const,
      repos: [],
      shouldCommit: true,
    };

    const result = await spawnAgent.spawn({ originatingNodeId: 'task-1', idempotencyKey: 'task-1:spawn', request });

    expect(result).toEqual({ outcome: 'ok', data: { idempotencyKey: 'task-1:spawn', spawned: true } });
    expect(spawnAgent.spawned).toEqual([{ originatingNodeId: 'task-1', idempotencyKey: 'task-1:spawn', request }]);
  });
});

describe('FakeRunCommandPort', () => {
  it('records every run and never shells out for real', async () => {
    const { runCommand } = createFakedCapabilityPorts();
    const result = await runCommand.run({
      originatingNodeId: 'pr-1',
      idempotencyKey: 'pr-1:repo-a',
      command: 'gh',
      args: ['pr', 'create'],
    });

    expect(result).toEqual({ outcome: 'ok', data: { idempotencyKey: 'pr-1:repo-a', exitCode: 0, stdout: '', stderr: '' } });
    expect(runCommand.ran).toHaveLength(1);
  });
});

describe('FakeRequestHumanPort', () => {
  it('defaults to granted when unseeded, and returns a seeded response otherwise', async () => {
    const { requestHuman } = createFakedCapabilityPorts();

    const defaulted = await requestHuman.request({ originatingNodeId: 'approval-1', idempotencyKey: 'approval-1:decision', prompt: 'plan-level approval?' });
    expect(defaulted).toEqual({ outcome: 'ok', data: { idempotencyKey: 'approval-1:decision', response: 'granted' } });

    requestHuman.seed('approval-2:decision', 'denied');
    const seeded = await requestHuman.request({ originatingNodeId: 'approval-2', idempotencyKey: 'approval-2:decision', prompt: 'plan-level approval?' });
    expect(seeded.data.response).toBe('denied');
  });
});
