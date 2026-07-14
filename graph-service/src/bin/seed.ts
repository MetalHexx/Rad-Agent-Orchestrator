#!/usr/bin/env node
// graph-service/src/bin/seed.ts — the invocable `seed` verb: compiles a template file and seeds a
// project against a running daemon (spawning one via `ensure()` if none is up yet), printing the
// result as JSON. Template path and project id are `argv[2]`/`argv[3]`, falling back to
// `SEED_TEMPLATE_PATH`/`SEED_PROJECT` env vars.
import { seedFromTemplate } from '../lifecycle/seed-from-template.js';

const templatePath = process.argv[2] ?? process.env['SEED_TEMPLATE_PATH'];
const project = process.argv[3] ?? process.env['SEED_PROJECT'];

if (!templatePath || !project) {
  console.error('usage: seed.js <templatePath> <project> (or SEED_TEMPLATE_PATH / SEED_PROJECT env vars)');
  process.exitCode = 1;
} else {
  seedFromTemplate({ templatePath, project })
    .then((result) => {
      console.log(JSON.stringify(result));
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
