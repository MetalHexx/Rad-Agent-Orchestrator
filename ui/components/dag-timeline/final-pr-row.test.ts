import assert from 'node:assert/strict';
import { shouldRenderTimelineRow } from './dag-timeline-helpers';
import type { StepNodeState } from '@/types/state';

const stepNode: StepNodeState = { kind: 'step', status: 'completed', doc_path: null, retries: 0 };

// FR-14: the final_pr row is always removed.
assert.equal(shouldRenderTimelineRow('final_pr', stepNode), false);
// Unrelated rows still render.
assert.equal(shouldRenderTimelineRow('phase_review', stepNode), true);

console.log('final-pr-row removal ✓');
