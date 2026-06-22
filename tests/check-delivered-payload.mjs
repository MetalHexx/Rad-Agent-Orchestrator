import { readdirSync, existsSync } from 'node:fs';

// Dev-only skills and artifacts that must never ship in the delivered payload.
const DENYLIST = new Set(['rad-ui-dev', 'rad-build-ui', 'rad-build-harness',
  'rad-create-agent', 'rad-create-skill', 'tests']);

export function findPayloadLeaks(entries) {
  return entries.filter((e) => DENYLIST.has(e));
}

function main() {
  const dir = 'harness-files/skills';
  const entries = existsSync(dir) ? readdirSync(dir) : [];
  const leaks = findPayloadLeaks(entries);
  if (leaks.length) {
    console.error(`Delivered payload leak in ${dir}: ${leaks.join(', ')}`);
    process.exit(1);
  }
  console.log('Delivered payload clean.');
}

if (import.meta.url === `file://${process.argv[1]}`) main();
