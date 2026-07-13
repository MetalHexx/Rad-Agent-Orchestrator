import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRealCapabilityPorts } from '../../src/capabilities/real.js';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'graph-service-real-capabilities-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('createRealCapabilityPorts', () => {
  it('builds all six ports', () => {
    const ports = createRealCapabilityPorts(root);
    expect(ports.docRead).toBeDefined();
    expect(ports.docWrite).toBeDefined();
    expect(ports.gitFacts).toBeDefined();
    expect(ports.spawnAgent).toBeDefined();
    expect(ports.runCommand).toBeDefined();
    expect(ports.requestHuman).toBeDefined();
  });

  it('still resolves gitFacts/spawnAgent/runCommand/requestHuman via the fakes', async () => {
    const ports = createRealCapabilityPorts(root);

    const facts = await ports.gitFacts.facts({ repoPath: '/repos/a' });
    expect(facts).toEqual({ outcome: 'ok', data: { branch: 'main', headSha: 'a1b2c3d', isClean: true } });

    const spawned = await ports.spawnAgent.spawn({
      originatingNodeId: 'task-1',
      idempotencyKey: 'task-1:spawn',
      request: { kind: 'coder', handoffDoc: '/tasks/t.md', complexity: 'simple', repos: [], shouldCommit: true },
    });
    expect(spawned).toEqual({ outcome: 'ok', data: { idempotencyKey: 'task-1:spawn', spawned: true } });

    const ran = await ports.runCommand.run({ originatingNodeId: 'pr-1', idempotencyKey: 'pr-1:repo-a', command: 'gh', args: [] });
    expect(ran.outcome).toBe('ok');

    const human = await ports.requestHuman.request({ originatingNodeId: 'a-1', idempotencyKey: 'a-1:decision', prompt: 'ok?' });
    expect(human).toEqual({ outcome: 'ok', data: { idempotencyKey: 'a-1:decision', response: 'granted' } });
  });
});

describe('RealDocReadPort / RealDocWritePort', () => {
  it('round-trips a write then a read under the project root, echoing the idempotency key', async () => {
    const { docRead, docWrite } = createRealCapabilityPorts(root);

    const writeResult = await docWrite.write({
      originatingNodeId: 'node-1',
      idempotencyKey: 'node-1:write',
      path: 'docs/out.md',
      content: '# Hello',
    });
    expect(writeResult).toEqual({ outcome: 'ok', data: { idempotencyKey: 'node-1:write', path: 'docs/out.md' } });

    const onDisk = await fs.readFile(path.join(root, 'docs/out.md'), 'utf8');
    expect(onDisk).toBe('# Hello');

    const readResult = await docRead.read({ path: 'docs/out.md' });
    expect(readResult).toEqual({ outcome: 'ok', data: { content: '# Hello' } });
  });

  it('creates parent directories that do not yet exist', async () => {
    const { docWrite } = createRealCapabilityPorts(root);

    await docWrite.write({
      originatingNodeId: 'node-1',
      idempotencyKey: 'node-1:write',
      path: 'nested/deeper/plan.md',
      content: 'nested',
    });

    const onDisk = await fs.readFile(path.join(root, 'nested/deeper/plan.md'), 'utf8');
    expect(onDisk).toBe('nested');
  });

  it('returns an error envelope for a missing file on read', async () => {
    const { docRead } = createRealCapabilityPorts(root);
    const result = await docRead.read({ path: 'does/not/exist.md' });
    expect(result.outcome).toBe('error');
  });

  it('rejects a `..` traversal on read and write without writing anything', async () => {
    const { docRead, docWrite } = createRealCapabilityPorts(root);

    const readResult = await docRead.read({ path: '../escape.md' });
    expect(readResult.outcome).toBe('error');

    const writeResult = await docWrite.write({
      originatingNodeId: 'node-1',
      idempotencyKey: 'node-1:escape',
      path: '../escape.md',
      content: 'nope',
    });
    expect(writeResult.outcome).toBe('error');
    expect(writeResult.data.idempotencyKey).toBe('node-1:escape');

    await expect(fs.access(path.join(root, '..', 'escape.md'))).rejects.toThrow();
  });

  it('rejects an absolute path outside the root without writing anything', async () => {
    const { docRead, docWrite } = createRealCapabilityPorts(root);
    const outsideAbsolute = path.join(os.tmpdir(), 'graph-service-real-capabilities-outside.md');

    const readResult = await docRead.read({ path: outsideAbsolute });
    expect(readResult.outcome).toBe('error');

    const writeResult = await docWrite.write({
      originatingNodeId: 'node-1',
      idempotencyKey: 'node-1:outside',
      path: outsideAbsolute,
      content: 'nope',
    });
    expect(writeResult.outcome).toBe('error');

    await expect(fs.access(outsideAbsolute)).rejects.toThrow();
  });
});
