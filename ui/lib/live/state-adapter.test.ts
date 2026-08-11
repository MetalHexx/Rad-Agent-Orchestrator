import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stateTopicForProject, lifecycleTopic, classifyStateEvent, classifyLifecycleEvent } from './state-adapter';

const ROOT = '/projects';

test('state topic key is scoped per project', () => {
  assert.equal(stateTopicForProject('DEMO'), 'state:DEMO');
});

test('a state.json change classifies into a per-project state event (FR-1, DD-1)', () => {
  assert.deepEqual(
    classifyStateEvent({ type: 'change', filePath: '/projects/DEMO/state.json' }, ROOT),
    { topic: 'state:DEMO', projectName: 'DEMO' },
  );
});

test('a non-state.json change yields null for the state classifier (AD-1)', () => {
  assert.equal(classifyStateEvent({ type: 'change', filePath: '/projects/DEMO/DEMO-PLAN.md' }, ROOT), null);
  assert.equal(classifyStateEvent({ type: 'change', filePath: '/projects/loose.json' }, ROOT), null);
});

test('lifecycle topic is a single shared key', () => {
  assert.equal(lifecycleTopic(), 'lifecycle');
});

test('a state.json add classifies as project_added (FR-3, DD-3)', () => {
  assert.deepEqual(
    classifyLifecycleEvent({ type: 'add', filePath: '/projects/NEW/state.json' }, ROOT),
    { topic: 'lifecycle', kind: 'project_added', projectName: 'NEW' },
  );
});

test('a state.json unlink classifies as project_removed (FR-3, DD-3)', () => {
  assert.deepEqual(
    classifyLifecycleEvent({ type: 'unlink', filePath: '/projects/OLD/state.json' }, ROOT),
    { topic: 'lifecycle', kind: 'project_removed', projectName: 'OLD' },
  );
});

test('a first-level directory add with no state.json classifies as project_added (FR-3, FR-4)', () => {
  assert.deepEqual(
    classifyLifecycleEvent({ type: 'addDir', filePath: '/projects/DOCONLY' }, ROOT),
    { topic: 'lifecycle', kind: 'project_added', projectName: 'DOCONLY' },
  );
});

test('a first-level directory unlink classifies as project_removed (FR-3)', () => {
  assert.deepEqual(
    classifyLifecycleEvent({ type: 'unlinkDir', filePath: '/projects/DOCONLY' }, ROOT),
    { topic: 'lifecycle', kind: 'project_removed', projectName: 'DOCONLY' },
  );
});

test('the projects root itself and nested dirs never classify as lifecycle (FR-4)', () => {
  assert.equal(classifyLifecycleEvent({ type: 'addDir', filePath: '/projects' }, ROOT), null);
  assert.equal(classifyLifecycleEvent({ type: 'addDir', filePath: '/projects/DEMO/tasks' }, ROOT), null);
});

test('a state.json add/unlink under a non-project directory name yields no lifecycle event', () => {
  assert.equal(classifyLifecycleEvent({ type: 'add', filePath: '/projects/.git/state.json' }, ROOT), null);
  assert.equal(classifyLifecycleEvent({ type: 'unlink', filePath: '/projects/_archived/state.json' }, ROOT), null);
});

test('a first-level directory add/remove for a non-project directory name yields no lifecycle event', () => {
  assert.equal(classifyLifecycleEvent({ type: 'addDir', filePath: '/projects/.git' }, ROOT), null);
  assert.equal(classifyLifecycleEvent({ type: 'addDir', filePath: '/projects/_future' }, ROOT), null);
  assert.equal(classifyLifecycleEvent({ type: 'unlinkDir', filePath: '/projects/_archived' }, ROOT), null);
});
