import assert from 'node:assert/strict';
import { hasSourceControlRepos } from './source-control-helpers';

// FR-3: absent source_control or empty repos → hidden (same treatment)
assert.equal(hasSourceControlRepos(null), false);
assert.equal(hasSourceControlRepos({ repos: [] }), false);
assert.equal(hasSourceControlRepos({ repos: undefined }), false);
assert.equal(hasSourceControlRepos({ repos: [{ name: 'fake-api' }] }), true);

console.log('source-control-visibility ✓');
