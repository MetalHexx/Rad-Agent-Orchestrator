import { describe, it, expect } from 'vitest';
import { findTaskLoopBodyDefs } from '../../../src/lib/pipeline-engine/scaffold.js';
import type { PipelineTemplate } from '../../../src/lib/pipeline-engine/types.js';

describe('findTaskLoopBodyDefs', () => {
  it('returns the for_each_task body nested under the template for_each_phase node', () => {
    const tmpl = {
      id: 't', version: '1', description: '',
      nodes: [
        {
          id: 'phase_loop', kind: 'for_each_phase', label: 'P', source_doc_ref: '', total_field: 'total_phases', depends_on: [],
          body: [
            {
              id: 'task_loop', kind: 'for_each_task', label: 'T', source_doc_ref: '', tasks_field: 'tasks', depends_on: [],
              body: [
                { id: 'task_gate', kind: 'gate' },
                { id: 'task_executor', kind: 'step' },
                { id: 'code_review', kind: 'step' },
              ],
            },
          ],
        },
      ],
    } as unknown as PipelineTemplate;

    const bodyDefs = findTaskLoopBodyDefs(tmpl);
    expect(bodyDefs.map(d => d.id)).toEqual(['task_gate', 'task_executor', 'code_review']);
  });

  it('returns an empty array for a template with no for_each_task body', () => {
    const tmpl = {
      id: 't', version: '1', description: '',
      nodes: [
        { id: 'master_plan', kind: 'step', label: 'M', action: 'spawn_master_plan', events: { completed: 'master_plan_completed' }, depends_on: [] },
      ],
    } as unknown as PipelineTemplate;

    expect(findTaskLoopBodyDefs(tmpl)).toEqual([]);
  });
});
