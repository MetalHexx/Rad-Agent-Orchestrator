import assert from 'node:assert/strict';
import { parseRegistrySelection, selectionToQuery } from './url-selection';

// parse — repo wins when both present; trims; null when neither (FR-13)
assert.deepEqual(parseRegistrySelection({ repo: 'fake-api', group: null }), { kind: 'repo', slug: 'fake-api' });
assert.deepEqual(parseRegistrySelection({ repo: null, group: 'rad-orc' }), { kind: 'group', slug: 'rad-orc' });
assert.deepEqual(parseRegistrySelection({ repo: 'fake-api', group: 'rad-orc' }), { kind: 'repo', slug: 'fake-api' });
assert.equal(parseRegistrySelection({ repo: '', group: '' }), null);
assert.equal(parseRegistrySelection({ repo: null, group: null }), null);

// serialize — round-trips, encodes, blanks to bare path (AD-4)
assert.equal(selectionToQuery({ kind: 'repo', slug: 'fake-api' }), '/repo-registry?repo=fake-api');
assert.equal(selectionToQuery({ kind: 'group', slug: 'rad orc' }), '/repo-registry?group=rad%20orc');
assert.equal(selectionToQuery(null), '/repo-registry');

console.log('url-selection ✓');
