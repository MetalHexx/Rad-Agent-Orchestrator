import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkGraphService } from '@rad-orchestration/work-graph';
import { writeProjectIndexEntry, readProjectIndex } from '@rad-orchestration/telemetry';
import { projectDeleteCommand } from '../../../src/commands/project/delete.js';
import { UserError } from '../../../src/framework/errors.js';
import type { CommandContext } from '../../../src/framework/context.js';

let tmpHome: string;
let homedirSpy: ReturnType<typeof vi.spyOn>;

function makeCtx(json: boolean): { ctx: CommandContext; writes: string[] } {
  const writes: string[] = [];
  const ctx = {
    ux: { json },
    stderr: { write: (s: string) => { writes.push(s); return true; } },
  } as unknown as CommandContext;
  return { ctx, writes };
}

function writeProject(name: string): void {
  const dir = path.join(tmpHome, '.radorc', 'projects', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ project: { name }, graph: { nodes: {} } }));
}

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-'));
  homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(tmpHome);
});

afterEach(() => {
  homedirSpy.mockRestore();
  vi.restoreAllMocks();
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe('project delete — preview mode', () => {
  it('reports the plan and removes nothing', async () => {
    writeProject('MR-1');
    const { ctx } = makeCtx(true);
    const result = await projectDeleteCommand.handler({ args: { id: 'MR-1' }, flags: { preview: true }, ctx });
    expect(result.preview).toBe(true);
    expect(result.project).toBe('MR-1');
    expect(result.items.some((i) => i.kind === 'project-dir')).toBe(true);
    expect(fs.existsSync(path.join(tmpHome, '.radorc', 'projects', 'MR-1'))).toBe(true);
  });

  it('surfaces an unknown project as a UserError', async () => {
    const { ctx } = makeCtx(true);
    await expect(
      projectDeleteCommand.handler({ args: { id: 'NOPE' }, flags: { preview: true }, ctx }),
    ).rejects.toThrow(UserError);
  });
});

describe('project delete — delete mode', () => {
  it('removes the project and reports a complete envelope', async () => {
    writeProject('MR-2');
    const { ctx } = makeCtx(true);
    const result = await projectDeleteCommand.handler({ args: { id: 'MR-2' }, flags: {}, ctx });
    expect(result.preview).toBe(false);
    if (result.preview) throw new Error('unreachable');
    expect(result.complete).toBe(true);
    expect(fs.existsSync(path.join(tmpHome, '.radorc', 'projects', 'MR-2'))).toBe(false);
  });

  it('requires --id', async () => {
    const { ctx } = makeCtx(true);
    await expect(
      projectDeleteCommand.handler({ args: {}, flags: {}, ctx }),
    ).rejects.toThrow(UserError);
  });

  it('surfaces an unknown project as a UserError instead of a silent no-op success', async () => {
    const { ctx } = makeCtx(true);
    await expect(
      projectDeleteCommand.handler({ args: { id: 'NOPE' }, flags: {}, ctx }),
    ).rejects.toThrow(UserError);
  });

  it('does not block a resumable retry when the project directory still exists (partial delete)', async () => {
    const deleteSpy = vi.spyOn(WorkGraphService.prototype, 'deleteProject').mockReturnValue({
      ok: true,
      data: {
        project: 'MR-6',
        complete: false,
        items: [
          { kind: 'worktree', label: 'repo-a', path: '/wt/MR-6/repo-a', exists: true, disposition: 'remove', outcome: 'failed', error: 'boom' },
          { kind: 'project-dir', label: 'MR-6', path: '/projects/MR-6', exists: true, disposition: 'remove', outcome: 'held-back', error: "blocked by worktree 'repo-a'" },
        ],
      },
    });
    const { ctx } = makeCtx(true);
    const result = await projectDeleteCommand.handler({ args: { id: 'MR-6' }, flags: {}, ctx });
    expect(deleteSpy).toHaveBeenCalled();
    expect(result.preview).toBe(false);
    if (result.preview) throw new Error('unreachable');
    expect(result.complete).toBe(false);
  });

  it("clears the deleted project's telemetry index claims, leaving other projects' claims intact", async () => {
    writeProject('MR-8');
    const telemetryRoot = path.join(tmpHome, '.radorc', 'telemetry');
    writeProjectIndexEntry(telemetryRoot, { sessionId: 's1', project: 'MR-8' });
    writeProjectIndexEntry(telemetryRoot, { sessionId: 's2', project: 'OTHER' });

    const { ctx } = makeCtx(true);
    await projectDeleteCommand.handler({ args: { id: 'MR-8' }, flags: {}, ctx });

    expect(readProjectIndex(telemetryRoot).sessions.map((s) => s.sessionId)).toEqual(['s2']);
  });

  it('leaves telemetry claims intact when the project directory is held back (partial delete)', async () => {
    const telemetryRoot = path.join(tmpHome, '.radorc', 'telemetry');
    writeProjectIndexEntry(telemetryRoot, { sessionId: 's1', project: 'MR-9' });
    vi.spyOn(WorkGraphService.prototype, 'deleteProject').mockReturnValue({
      ok: true,
      data: {
        project: 'MR-9',
        complete: false,
        items: [
          { kind: 'worktree', label: 'repo-a', path: '/wt/MR-9/repo-a', exists: true, disposition: 'remove', outcome: 'failed', error: 'boom' },
          { kind: 'project-dir', label: 'MR-9', path: '/projects/MR-9', exists: true, disposition: 'remove', outcome: 'held-back', error: "blocked by worktree 'repo-a'" },
        ],
      },
    });
    const { ctx } = makeCtx(true);
    await projectDeleteCommand.handler({ args: { id: 'MR-9' }, flags: {}, ctx });

    expect(readProjectIndex(telemetryRoot).sessions.map((s) => s.sessionId)).toEqual(['s1']);
  });

  it('leaves telemetry claims intact when the project directory outcome is failed rather than removed', async () => {
    const telemetryRoot = path.join(tmpHome, '.radorc', 'telemetry');
    writeProjectIndexEntry(telemetryRoot, { sessionId: 's1', project: 'MR-10' });
    vi.spyOn(WorkGraphService.prototype, 'deleteProject').mockReturnValue({
      ok: true,
      data: {
        project: 'MR-10',
        complete: false,
        items: [
          { kind: 'project-dir', label: 'MR-10', path: '/projects/MR-10', exists: true, disposition: 'remove', outcome: 'failed', error: 'permission denied' },
        ],
      },
    });
    const { ctx } = makeCtx(true);
    await projectDeleteCommand.handler({ args: { id: 'MR-10' }, flags: {}, ctx });

    expect(readProjectIndex(telemetryRoot).sessions.map((s) => s.sessionId)).toEqual(['s1']);
  });

  it('completes leftover graph-edges work on retry even after the project directory itself is already gone', async () => {
    const deleteSpy = vi.spyOn(WorkGraphService.prototype, 'deleteProject').mockReturnValue({
      ok: true,
      data: {
        project: 'MR-7',
        complete: true,
        items: [
          { kind: 'project-dir', label: 'MR-7', path: '/projects/MR-7', exists: false, disposition: 'remove', outcome: 'already-absent' },
          { kind: 'graph-edges', label: 'MR-7', path: null, exists: true, disposition: 'remove', outcome: 'removed' },
        ],
      },
    });
    const { ctx } = makeCtx(true);
    const result = await projectDeleteCommand.handler({ args: { id: 'MR-7' }, flags: {}, ctx });
    expect(deleteSpy).toHaveBeenCalled();
    expect(result.preview).toBe(false);
    if (result.preview) throw new Error('unreachable');
    expect(result.complete).toBe(true);
  });
});

describe('project delete — human summary', () => {
  it('writes a one-line-per-item summary to stderr when not in JSON mode', async () => {
    writeProject('MR-3');
    const { ctx, writes } = makeCtx(false);
    await projectDeleteCommand.handler({ args: { id: 'MR-3' }, flags: { preview: true }, ctx });
    expect(writes.length).toBe(1);
    expect(writes[0]).toContain('project-dir');
    expect(writes[0]).toContain('MR-3');
  });

  it('writes nothing to stderr in JSON mode', async () => {
    writeProject('MR-4');
    const { ctx, writes } = makeCtx(true);
    await projectDeleteCommand.handler({ args: { id: 'MR-4' }, flags: { preview: true }, ctx });
    expect(writes).toEqual([]);
  });

  it('tells the operator a held-back delete can be re-run to finish', async () => {
    vi.spyOn(WorkGraphService.prototype, 'deleteProject').mockReturnValue({
      ok: true,
      data: {
        project: 'MR-5',
        complete: false,
        items: [
          { kind: 'worktree', label: 'repo-a', path: '/wt/MR-5/repo-a', exists: true, disposition: 'remove', outcome: 'failed', error: 'boom' },
          { kind: 'project-dir', label: 'MR-5', path: '/projects/MR-5', exists: true, disposition: 'remove', outcome: 'held-back', error: "blocked by worktree 'repo-a'" },
        ],
      },
    });
    const { ctx, writes } = makeCtx(false);
    await projectDeleteCommand.handler({ args: { id: 'MR-5' }, flags: {}, ctx });
    expect(writes[0]).toMatch(/re-run/i);
  });
});

describe('project delete — mapResult', () => {
  it('exits 0 for a preview, regardless of item dispositions', () => {
    const envelope = projectDeleteCommand.mapResult?.({ project: 'X', preview: true, items: [] });
    expect(envelope?.exit_code).toBe(0);
  });
  it('exits 0 for a complete delete', () => {
    const envelope = projectDeleteCommand.mapResult?.({ project: 'X', preview: false, items: [], complete: true });
    expect(envelope?.exit_code).toBe(0);
  });
  it('exits 1 when the report is not complete', () => {
    const envelope = projectDeleteCommand.mapResult?.({ project: 'X', preview: false, items: [], complete: false });
    expect(envelope?.exit_code).toBe(1);
  });
});
