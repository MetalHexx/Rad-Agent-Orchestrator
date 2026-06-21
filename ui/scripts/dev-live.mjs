// Dev launcher for the dashboard: runs `next dev` (Fast Refresh / live reload)
// with RADORCH_CLI_PATH wired automatically, so server-side routes that shell
// out to the CLI (gate actions, action-event compose Preview) work in dev the
// same way they do under `radorch ui start` — without the production build.
//
// It ALSO builds the UI's `@rad-orchestration/*` workspace libs (their `dist/`)
// before starting `next dev`. Those libs are consumed by the dev server via the
// workspace symlink → `dist/` (they're marked `serverComponentsExternalPackages`
// in next.config.mjs), and Fast Refresh does NOT watch that external `dist`. So
// when lib source lands but its `dist` is stale, the dev server silently serves
// old built output. Building on startup makes the data path correct on launch.
//
// Flags (consumed here; everything else is forwarded to `next dev`):
//   --watch-libs   also watch each lib's src/ and, on change, rebuild that lib
//                  and restart `next dev` (the require-cache holds the old module
//                  otherwise). Opt-in because each lib edit costs a dev restart.
//   --skip-libs    skip the startup lib build (fast path for pure-UI work).
//
// The production launcher (cli/src/commands/ui/start.ts) sets RADORCH_CLI_PATH
// to whatever radorch binary spawned the UI. In dev we point it at the locally
// built CLI entry so changes to the CLI are picked up after a `cd cli && npm run build`.
//
// Plain `npm run dev` stays untouched for pure UI work (read-only surfaces).
// Use `npm run dev:live` (or `dev:live:watch`) when you need the full-fidelity loop.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uiRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(uiRoot, "..");
const cliPath = path.resolve(repoRoot, "cli", "dist", "bin", "radorch.js");
const isWin = process.platform === "win32";

// --- arg parsing: split our flags from the next-dev passthrough -------------
const rawArgs = process.argv.slice(2);
const watchLibs = rawArgs.includes("--watch-libs");
const skipLibs = rawArgs.includes("--skip-libs");
const nextArgs = rawArgs.filter((a) => a !== "--watch-libs" && a !== "--skip-libs");

// --- resolve the UI's @rad-orchestration/* lib deps, in build order ---------
// Mirror the canonical lib build order used by the installer build
// (harness-installers/standard/build-scripts/build.js -> build-lib-dist step):
// repo-registry must precede work-graph (work-graph depends on it).
const CANONICAL_ORDER = [
  "@rad-orchestration/repo-registry",
  "@rad-orchestration/work-graph",
  "@rad-orchestration/telemetry",
];

function resolveLibDeps() {
  const pkg = JSON.parse(readFileSync(path.join(uiRoot, "package.json"), "utf8"));
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const names = Object.keys(deps).filter((n) => n.startsWith("@rad-orchestration/"));
  const ordered = CANONICAL_ORDER.filter((n) => names.includes(n));
  const extras = names.filter((n) => !CANONICAL_ORDER.includes(n)).sort();
  return [...ordered, ...extras];
}

// Map a package name to its lib source dir (lib/<shortname>/src), if present.
function libSrcDir(pkgName) {
  const short = pkgName.split("/")[1];
  const dir = path.join(repoRoot, "lib", short, "src");
  return existsSync(dir) ? dir : null;
}

/** Build one lib's dist via the workspace build script. Returns true on success. */
function buildLib(pkgName) {
  process.stdout.write(`[dev:live] building ${pkgName}…\n`);
  const res = spawnSync("npm", ["run", "build", "-w", pkgName], {
    cwd: repoRoot,
    stdio: "inherit",
    shell: isWin, // npm is npm.cmd on Windows
  });
  return res.status === 0;
}

const libDeps = resolveLibDeps();

if (skipLibs) {
  console.log("[dev:live] --skip-libs: skipping workspace lib build");
} else if (libDeps.length === 0) {
  console.log("[dev:live] no @rad-orchestration/* deps to build");
} else {
  for (const pkg of libDeps) {
    if (!buildLib(pkg)) {
      console.error(
        `\n[dev:live] ERROR: build failed for ${pkg}. ` +
          `Refusing to start next dev on a stale/broken dist.\n`
      );
      process.exit(1);
    }
  }
  console.log(`[dev:live] lib dist up to date (${libDeps.join(", ")})`);
}

// --- CLI path wiring (unchanged behavior) -----------------------------------
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

/** Spawn `next dev` and return the child handle. */
function startNext() {
  return spawn(process.execPath, [nextBin, "dev", ...nextArgs], {
    stdio: "inherit",
    cwd: uiRoot,
    env: { ...process.env, RADORCH_CLI_PATH: cliPath },
  });
}

/** Kill a next-dev child AND its worker tree (the Windows start-server.js worker
 *  survives a plain child.kill(), orphaning the port). */
function killTree(child) {
  if (!child || child.killed) return;
  if (isWin && child.pid) {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    child.kill("SIGTERM");
  }
}

let child = startNext();
child.on("exit", (code) => {
  // If next exits on its own (not during a watch-triggered restart), mirror its code.
  if (!restarting) process.exit(code ?? 0);
});

// --- optional: watch lib src, rebuild + restart next on change --------------
let restarting = false;
if (watchLibs) {
  const watched = libDeps
    .map((pkg) => ({ pkg, src: libSrcDir(pkg) }))
    .filter((w) => w.src);
  const missing = libDeps.filter((pkg) => !libSrcDir(pkg));
  if (missing.length) {
    console.warn(`[dev:live] --watch-libs: no src dir found for ${missing.join(", ")} (skipped)`);
  }

  if (watched.length === 0) {
    console.warn("[dev:live] --watch-libs: nothing to watch");
  } else {
    const { default: chokidar } = await import("chokidar");
    const dirty = new Set();
    let timer = null;
    let busy = false;

    const flush = async () => {
      if (busy) return; // a rebuild is mid-flight; the trailing change re-arms below
      const pkgs = [...dirty];
      dirty.clear();
      if (pkgs.length === 0) return;
      busy = true;
      restarting = true;
      try {
        // Rebuild in canonical order so a dep is built before its dependent.
        const inOrder = libDeps.filter((p) => pkgs.includes(p));
        let ok = true;
        for (const pkg of inOrder) {
          process.stdout.write(`[dev:live] ${pkg} changed → rebuilding…\n`);
          if (!buildLib(pkg)) {
            ok = false;
            console.error(`[dev:live] rebuild failed for ${pkg}; keeping current dev server`);
          }
        }
        if (ok) {
          console.log("[dev:live] restarting next dev…");
          killTree(child);
          await new Promise((r) => setTimeout(r, 400)); // let the port release
          child = startNext();
          child.on("exit", (code) => {
            if (!restarting) process.exit(code ?? 0);
          });
        }
      } finally {
        busy = false;
        restarting = false;
        if (dirty.size) schedule(); // changes arrived during the rebuild
      }
    };

    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, 300);
    };

    for (const { pkg, src } of watched) {
      chokidar
        .watch(src, { ignoreInitial: true })
        .on("all", () => {
          dirty.add(pkg);
          schedule();
        });
      console.log(`[dev:live] watching ${path.relative(repoRoot, src)} → ${pkg}`);
    }
  }
}

// Clean up the child tree on Ctrl+C / termination so the port is freed.
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    restarting = true; // suppress the child 'exit' handler's process.exit
    killTree(child);
    process.exit(0);
  });
}
