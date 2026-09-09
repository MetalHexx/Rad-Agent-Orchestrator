import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkGraphService } from '@rad-orchestration/work-graph';
import { projectListCommand } from '../../../src/commands/project/list.js';
import type { CommandContext } from '../../../src/framework/context.js';

let tmpHome: string;
let homedirSpy: ReturnType<typeof vi.spyOn>;
const ctx = { ux: { json: true } } as CommandContext;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-'));
  homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(tmpHome);
});

afterEach(() => {
  homedirSpy.mockRestore();
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

function writeProject(name: string, state: unknown): void {
  const dir = path.join(tmpHome, '.radorc', 'projects', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(state));
}

describe('project list — JSON envelope', () => {
  it('carries state/stateLabel through to every listed project, matching the underlying Project', async () => {
    writeProject('MR-1', { project: { name: 'MR-1' }, graph: { nodes: {} } });
    writeProject('MR-2', {
      pipeline: { current_tier: 'execution' },
      graph: { nodes: { phase_loop: { status: 'in_progress' } } },
    });

    const result = await projectListCommand.handler({ args: {}, flags: {}, ctx });

    const root = path.join(tmpHome, '.radorc');
    const expected = new WorkGraphService({ root }).listProjects();
    expect(result.projects).toHaveLength(expected.length);
    for (const p of expected) {
      expect(result.projects.find((r) => r.name === p.name)).toEqual({
        name: p.name,
        state: p.state,
        stateLabel: p.stateLabel,
        status: p.status,
        tier: p.tier,
        sourceControlInitialized: p.sourceControlInitialized,
      });
    }

    const executing = result.projects.find((r) => r.name === 'MR-2');
    expect(executing?.state).toBe('executing');
    expect(executing?.stateLabel).toBe('Executing');
  });

  it('--status filters the JSON envelope the same way it filters the human table', async () => {
    writeProject('MR-1', { project: { name: 'MR-1' }, graph: { nodes: {} } });
    writeProject('MR-2', {
      pipeline: { current_tier: 'execution' },
      graph: { nodes: { phase_loop: { status: 'in_progress' } } },
    });

    const result = await projectListCommand.handler({ args: {}, flags: { status: 'in_progress' }, ctx });

    expect(result.projects.map((p) => p.name)).toEqual(['MR-2']);
  });
});
