import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OBSERVABILITY_HELP_MD } from './help-content';

test('help content explains the load-bearing concepts in plain words (DD-9)', () => {
  const md = OBSERVABILITY_HELP_MD;
  assert.match(md, /Total Spend|effective tokens/i, 'explains Total Spend / effective tokens');
  assert.match(md, /not.*(dollar|cost|\$)/i, 'states it is not dollar cost yet');
  assert.match(md, /Active Now/i, 'explains Active Now');
  assert.match(md, /Today|Earlier/i, 'explains the day controls');
});
