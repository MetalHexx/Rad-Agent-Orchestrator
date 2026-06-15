import assert from 'node:assert/strict';
import { buildBindLookup, bindFor } from './source-control-bind';

const registryRepos = [
  { slug: 'fake-api', bind: { state: 'bound' as const, path: '/clones/fake-api' } },
  { slug: 'fake-ui', bind: { state: 'unbound' as const, path: null } },
];

const lookup = buildBindLookup(registryRepos);
assert.deepEqual(bindFor(lookup, 'fake-api'), { state: 'bound', path: '/clones/fake-api' });
assert.deepEqual(bindFor(lookup, 'fake-ui'), { state: 'unbound', path: null });
// A repo absent from the registry has no bind info (FR-5: no dot)
assert.equal(bindFor(lookup, 'not-registered'), undefined);

console.log('source-control-bind ✓');
