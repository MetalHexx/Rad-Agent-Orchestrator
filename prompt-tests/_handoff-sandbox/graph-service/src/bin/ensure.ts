#!/usr/bin/env node
// graph-service/src/bin/ensure.ts — the invocable `ensure` verb: guarantees a running daemon and
// prints its endpoint as JSON. The full CLI verb set (flags, `--json`, help, …) is a later
// iteration; this is just the mechanism made callable from a shell.
import { ensure } from '../lifecycle/ensure.js';

ensure()
  .then((result) => {
    console.log(JSON.stringify(result));
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
