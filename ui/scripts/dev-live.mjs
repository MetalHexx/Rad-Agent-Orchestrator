// Dev launcher for the dashboard: runs `next dev` (Fast Refresh / live reload)
// with RADORCH_CLI_PATH wired automatically, so server-side routes that shell
// out to the CLI (gate actions, action-event compose Preview) work in dev the
// same way they do under `radorch ui start` — without the production build.
//
// The production launcher (cli/src/commands/ui/start.ts) sets RADORCH_CLI_PATH
// to whatever radorch binary spawned the UI. In dev we point it at the locally
// built CLI entry so changes to the CLI are picked up after a `cd cli && npm run build`.
//
// Plain `npm run dev` stays untouched for pure UI work (read-only surfaces).
// Use `npm run dev:live` when you need the full-fidelity loop.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uiRoot = path.resolve(__dirname, "..");
const cliPath = path.resolve(uiRoot, "..", "cli", "dist", "bin", "radorch.js");

if (!existsSync(cliPath)) {
  console.warn(
    `\n[dev:live] WARNING: built CLI not found at ${cliPath}\n` +
      `[dev:live] Read-only surfaces will work, but gate actions and the compose Preview will 500.\n` +
      `[dev:live] Build it first:  cd cli && npm run build   (or npm run watch for continuous rebuilds)\n`
  );
} else {
  console.log(`[dev:live] RADORCH_CLI_PATH -> ${cliPath}`);
}

// Resolve next's bin from its package.json regardless of workspace hoisting
// (in this monorepo `next` lives in the repo-root node_modules, not ui/).
const nextPkg = require("next/package.json");
const binRel = typeof nextPkg.bin === "string" ? nextPkg.bin : nextPkg.bin.next;
const nextBin = path.join(path.dirname(require.resolve("next/package.json")), binRel);

const child = spawn(process.execPath, [nextBin, "dev", ...process.argv.slice(2)], {
  stdio: "inherit",
  cwd: uiRoot,
  env: { ...process.env, RADORCH_CLI_PATH: cliPath },
});

child.on("exit", (code) => process.exit(code ?? 0));
