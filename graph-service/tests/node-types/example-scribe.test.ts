// example:scribe is the capability-bearing example node type: unlike the zero-capability
// example:greet, its `resolve` does real host-side work through a declared capability port. This
// focused unit proves `resolve` calls the declared doc-write port with the expected path and hands
// back the declared completion token — not the written file's own content.
import type { ResolveContext } from '@rad-orchestration/graph-engine';
import { describe, expect, it } from 'vitest';
import { createFakedCapabilityPorts } from '../../src/capabilities/fakes.js';
import scribeNodeType from '../../../examples/example/dist/scribe.js';

describe('example:scribe', () => {
  it('declares the doc-write capability, a resolve hook, and its completion token', () => {
    expect(scribeNodeType.name).toBe('example:scribe');
    expect(scribeNodeType.capabilities).toEqual(['doc-write']);
    expect(scribeNodeType.completionToken).toBe('example:scribe.written');
    expect(typeof scribeNodeType.resolve).toBe('function');
  });

  it('resolve writes the note through the doc-write port and returns the completion outcome', async () => {
    const ports = createFakedCapabilityPorts();
    const ctx: ResolveContext = { nodeId: 'scribe-1', data: {}, nodes: [], edges: [], ports };

    const result = await scribeNodeType.resolve!(ctx);

    expect(ports.docWrite.writes).toHaveLength(1);
    expect(ports.docWrite.writes[0]).toMatchObject({
      originatingNodeId: 'scribe-1',
      idempotencyKey: 'scribe-1:write',
      path: 'example/scribe-1.txt',
    });
    expect(result).toEqual({
      token: 'example:scribe.written',
      envelope: { outcome: 'ok', data: { path: 'example/scribe-1.txt' } },
    });
  });

  it('resolve writes the declared content when the node data supplies one', async () => {
    const ports = createFakedCapabilityPorts();
    const ctx: ResolveContext = { nodeId: 'scribe-2', data: { content: 'Custom note.' }, nodes: [], edges: [], ports };

    await scribeNodeType.resolve!(ctx);

    expect(ports.docWrite.writes[0]?.content).toBe('Custom note.');
  });

  it('handle marks the node written on the completion token and ignores anything else', () => {
    expect(
      scribeNodeType.handle({
        token: 'example:scribe.written',
        nodeId: 'scribe-1',
        envelope: { outcome: 'ok', data: { path: 'example/scribe-1.txt' } },
      }),
    ).toEqual({ dataChange: { written: true } });

    expect(
      scribeNodeType.handle({ token: 'example:scribe.other', nodeId: 'scribe-1', envelope: { outcome: 'ok', data: {} } }),
    ).toEqual({});
    expect(
      scribeNodeType.handle({ token: 'example:scribe.written', nodeId: 'scribe-1', envelope: { outcome: 'error', data: {} } }),
    ).toEqual({});
  });

  it('projectStatus is done once written, not_started otherwise', () => {
    expect(scribeNodeType.projectStatus({})).toBe('not_started');
    expect(scribeNodeType.projectStatus({ written: true })).toBe('done');
  });
});
