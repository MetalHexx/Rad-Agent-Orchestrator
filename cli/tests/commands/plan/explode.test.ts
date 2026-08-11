import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { planExplode, planExplodeCommand } from '../../../src/commands/plan/explode.js';

function makePlan(body: string): { projectDir: string; masterPlanPath: string } {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-'));
  const masterPlanPath = path.join(projectDir, 'MP.md');
  fs.writeFileSync(masterPlanPath, body, 'utf8');
  return { projectDir, masterPlanPath };
}

describe('planExplode core + mapResult', () => {
  it('success branch returns success-typed result; mapResult sets exit_code 0', () => {
    const { projectDir, masterPlanPath } = makePlan(
      '## P01: A\n\n### P01-T01: T\n**Requirements:** FR-1\nbody\n');
    const r = planExplode({ projectDir, masterPlanPath, projectName: 'X' });
    expect(r.type).toBe('success');
    const env = planExplodeCommand.mapResult!(r);
    expect(env.ok).toBe(true);
    expect(env.exit_code).toBe(0);
    expect(env.data).toEqual({ emittedPhases: 1, emittedTasks: 1 });
  });

  it('parse_error branch returns ok:true envelope with exit_code 2 and structured data.error', () => {
    const { projectDir, masterPlanPath } = makePlan('### P01-T01: orphan\n');
    const r = planExplode({ projectDir, masterPlanPath, projectName: 'X' });
    expect(r.type).toBe('parse_error');
    const env = planExplodeCommand.mapResult!(r);
    expect(env.ok).toBe(true);
    expect(env.exit_code).toBe(2);
    const d = (env.data as { error: { line: number; expected: string; found: string; message: string } }).error;
    expect(Object.keys(d).sort()).toEqual(['expected', 'found', 'line', 'message']);
  });

  it('real_error branch returns ok:false envelope; framework maps system_error → 2', () => {
    // Create a valid plan but try to emit to a file path that cannot be created
    // (e.g., permission denied or a path component is a file instead of a directory)
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-'));
    const masterPlanPath = path.join(tempDir, 'MP.md');
    fs.writeFileSync(masterPlanPath, '## P01: A\n\n### P01-T01: T\n**Requirements:** FR-1\nbody\n', 'utf8');

    // Create a file where the phases directory should be
    const blockedPhasesPath = path.join(tempDir, 'phases');
    fs.writeFileSync(blockedPhasesPath, 'blocking file', 'utf8');

    const r = planExplode({
      projectDir: tempDir,
      masterPlanPath,
      projectName: 'X',
    });
    expect(r.type).toBe('real_error');
    const env = planExplodeCommand.mapResult!(r);
    expect(env.ok).toBe(false);
    expect(env.error?.type).toBe('system_error');
  });
});
