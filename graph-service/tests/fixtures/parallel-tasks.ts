// graph-service/tests/fixtures/parallel-tasks.ts
//
// Two independent sibling `rad-orc:task` nodes — no dependency edge between them — the
// parallel-native shape proving the frontier never artificially serializes unrelated work.
import { ROOT_NODE_ID } from '@rad-orchestration/graph-engine';
import type { SeedStep } from '../harness/drive.js';
import { taskData } from './repos.js';

export const PARALLEL_TASK_IDS = { a: 'task-a', b: 'task-b' } as const;

export function parallelTasksSeedSteps(): readonly SeedStep[] {
  return [
    { primitive: 'add_node', id: PARALLEL_TASK_IDS.a, type: 'rad-orc:task', parent: ROOT_NODE_ID, data: taskData('/tasks/task-a.md') },
    { primitive: 'add_node', id: PARALLEL_TASK_IDS.b, type: 'rad-orc:task', parent: ROOT_NODE_ID, data: taskData('/tasks/task-b.md') },
  ];
}
