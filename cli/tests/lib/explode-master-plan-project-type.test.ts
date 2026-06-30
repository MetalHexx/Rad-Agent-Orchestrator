import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { explodeMasterPlan } from '../../src/lib/explode-master-plan.js';

function tmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mp-ptype-'));
}
function seedState(dir: string): void {
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({
    project: { name: 'X', created: 'c', updated: 'u' },
    graph: { nodes: { phase_loop: { kind: 'for_each_phase', status: 'not_started', iterations: [] } } },
  }, null, 2));
}
function writeMp(dir: string, projectType: string | null): string {
  const fm = projectType === null ? '' : `project-type: ${projectType}\n`;
  const mp = `---\nproject: "X"\nrepos: [X]\n${fm}total_phases: 1\ntotal_tasks: 1\n---\n\n` +
    `## P01: Phase One\n**Target repo:** X\n\n### P01-T01: Do thing\nDoes the thing.\n**Complexity:** standard\n**Target repo:** X\n`;
  const p = path.join(dir, 'mp.md');
  fs.writeFileSync(p, mp);
  return p;
}

const dirs: string[] = [];
afterEach(() => { while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true }); });
beforeEach(() => { /* fresh per test */ });

describe('explosion seeds state.project.project_type', () => {
  it('writes side-project from frontmatter project-type', () => {
    const d = tmpProject(); dirs.push(d); seedState(d);
    explodeMasterPlan({ projectDir: d, masterPlanPath: writeMp(d, 'side-project'), projectName: 'X', nowIso: '2026-01-01T00:00:00Z' });
    const state = JSON.parse(fs.readFileSync(path.join(d, 'state.json'), 'utf8'));
    expect(state.project.project_type).toBe('side-project');
  });
  it('writes standard from frontmatter project-type', () => {
    const d = tmpProject(); dirs.push(d); seedState(d);
    explodeMasterPlan({ projectDir: d, masterPlanPath: writeMp(d, 'standard'), projectName: 'X', nowIso: '2026-01-01T00:00:00Z' });
    const state = JSON.parse(fs.readFileSync(path.join(d, 'state.json'), 'utf8'));
    expect(state.project.project_type).toBe('standard');
  });
  it('defaults to standard when frontmatter omits project-type', () => {
    const d = tmpProject(); dirs.push(d); seedState(d);
    explodeMasterPlan({ projectDir: d, masterPlanPath: writeMp(d, null), projectName: 'X', nowIso: '2026-01-01T00:00:00Z' });
    const state = JSON.parse(fs.readFileSync(path.join(d, 'state.json'), 'utf8'));
    expect(state.project.project_type).toBe('standard');
  });
});
