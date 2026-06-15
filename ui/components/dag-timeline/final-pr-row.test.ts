import assert from 'node:assert/strict';
import { shouldRenderTimelineRow } from './dag-timeline-helpers';
import type { StepNodeState } from '@/types/state';

const stepNode: StepNodeState = { kind: 'step', status: 'completed', doc_path: null, retries: 0 };

// FR-14: the final_pr row is always removed, even when a PR url is present.
assert.equal(shouldRenderTimelineRow('final_pr', stepNode, { commitHash: null, prUrl: 'https://github.com/o/r/pull/9' }), false);
assert.equal(shouldRenderTimelineRow('final_pr', stepNode, { commitHash: null, prUrl: null }), false);
// Unrelated rows still render.
assert.equal(shouldRenderTimelineRow('phase_review', stepNode, { commitHash: null, prUrl: null }), true);

console.log('final-pr-row removal ✓');
