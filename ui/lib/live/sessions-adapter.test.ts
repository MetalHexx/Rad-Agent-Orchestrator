import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionsTopicForProject, classifySessionsEvent } from './sessions-adapter';

const ROOT = '/projects';

test('sessions topic key is scoped per project', () => {
  assert.equal(sessionsTopicForProject('DEMO'), 'sessions:DEMO');
});

test('an exact .project-sessions.json add/change classifies into a per-project sessions event', () => {
  assert.deepEqual(
    classifySessionsEvent({ type: 'add', filePath: '/projects/DEMO/.project-sessions.json' }, ROOT),
    { topic: 'sessions:DEMO', projectName: 'DEMO' },
  );
  assert.deepEqual(
    classifySessionsEvent({ type: 'change', filePath: '/projects/DEMO/.project-sessions.json' }, ROOT),
    { topic: 'sessions:DEMO', projectName: 'DEMO' },
  );
});

test('an unlink of the sessions file yields null (only add/change classify)', () => {
  assert.equal(classifySessionsEvent({ type: 'unlink', filePath: '/projects/DEMO/.project-sessions.json' }, ROOT), null);
});

test('the writer\'s lock file never classifies, even though it starts with the same basename', () => {
  assert.equal(classifySessionsEvent({ type: 'add', filePath: '/projects/DEMO/.project-sessions.json.lock' }, ROOT), null);
  assert.equal(classifySessionsEvent({ type: 'change', filePath: '/projects/DEMO/.project-sessions.json.lock' }, ROOT), null);
});

test('the writer\'s pid-scoped tmp file never classifies', () => {
  assert.equal(classifySessionsEvent({ type: 'add', filePath: '/projects/DEMO/.project-sessions.json.48213.tmp' }, ROOT), null);
});

test('a nested path (more than two segments) yields null', () => {
  assert.equal(classifySessionsEvent({ type: 'change', filePath: '/projects/DEMO/tasks/.project-sessions.json' }, ROOT), null);
});

test('a one-segment path (not inside a project directory) yields null', () => {
  assert.equal(classifySessionsEvent({ type: 'change', filePath: '/projects/.project-sessions.json' }, ROOT), null);
});

test('a path outside the projects root yields null', () => {
  assert.equal(classifySessionsEvent({ type: 'change', filePath: '/elsewhere/DEMO/.project-sessions.json' }, ROOT), null);
});

test('a state.json change under the same project yields null', () => {
  assert.equal(classifySessionsEvent({ type: 'change', filePath: '/projects/DEMO/state.json' }, ROOT), null);
});
