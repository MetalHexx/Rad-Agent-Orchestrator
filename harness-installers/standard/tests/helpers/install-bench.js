// harness-installers/standard/tests/helpers/install-bench.js —
// Per-installer test helper for exercising the manifest-driven install and
// removal paths under a tmp ${RAD_HOME}. Stages a synthetic bundle that
// mirrors what the standard build emits for the action-events catalog, then
// drives `installManifestFiles` / `removeManifestFiles` directly.
//
// Per the harness-installer encapsulation rule, this helper lives inside the
// standard installer tree only — never `require` a sibling.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installManifestFiles } from '../../lib/install/install-files.js';
import { removeManifestFiles } from '../../lib/install/remove-files.js';

/** Runs the test body under a temp ${RAD_HOME} (HOME/USERPROFILE pointed at it)
 *  and cleans up afterward. */
export async function withTempHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'install-bench-'));
  const prevHome = process.env.HOME;
  const prevUserProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    await fn(home);
  } finally {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevUserProfile;
    fs.rmSync(home, { recursive: true, force: true });
  }
}

/** Stages a synthetic bundle containing an action-events catalog whose layout
 *  matches what `runtime-config/action-events/` ships, and returns the bundle
 *  path plus the matching manifest (with `${RAD_HOME}/action-events/...`
 *  destinations as emit-manifest would produce). */
export function stageActionEventsBundle(home, { harness = 'claude' } = {}) {
  const bundle = path.join(home, 'bundle');
  const aeDir = path.join(bundle, 'action-events');
  fs.mkdirSync(path.join(aeDir, 'custom'), { recursive: true });
  fs.writeFileSync(path.join(aeDir, 'README.md'), '# action-events\n');
  fs.writeFileSync(path.join(aeDir, 'action.spawn_coder.md'), '# spawn_coder\n');
  fs.writeFileSync(path.join(aeDir, 'event.task_completed.md'), '# task_completed\n');

  const manifest = {
    files: [
      {
        bundlePath: 'action-events/README.md',
        destinationPath: '${RAD_HOME}/action-events/README.md',
        sha256: 'x',
      },
      {
        bundlePath: 'action-events/action.spawn_coder.md',
        destinationPath: '${RAD_HOME}/action-events/action.spawn_coder.md',
        sha256: 'x',
      },
      {
        bundlePath: 'action-events/event.task_completed.md',
        destinationPath: '${RAD_HOME}/action-events/event.task_completed.md',
        sha256: 'x',
      },
    ],
  };

  return { bundle, manifest, harness };
}

/** Stages a synthetic bundle containing the communication-styles catalog whose
 *  layout matches what `runtime-config/communication-styles/` ships, and
 *  returns the bundle path plus the matching manifest (with
 *  `${RAD_HOME}/communication-styles/...` destinations as emit-manifest would
 *  produce). */
export function stageCommunicationStylesBundle(home, { harness = 'claude' } = {}) {
  const bundle = path.join(home, 'bundle');
  const csDir = path.join(bundle, 'communication-styles');
  fs.mkdirSync(path.join(csDir, 'custom'), { recursive: true });
  const styles = ['direct.md', 'caveman.md', 'high-level.md', 'socratic.md'];
  for (const style of styles) {
    fs.writeFileSync(path.join(csDir, style), `# ${style}\n`);
  }

  const manifest = {
    files: styles.map((style) => ({
      bundlePath: `communication-styles/${style}`,
      destinationPath: `\${RAD_HOME}/communication-styles/${style}`,
      sha256: 'x',
    })),
  };

  return { bundle, manifest, harness };
}

/** Runs a manifest-driven install for the staged action-events and
 *  communication-styles bundles, sharing a single bundle root. */
export function installFull(home, { harness = 'claude' } = {}) {
  const { bundle, manifest: aeManifest } = stageActionEventsBundle(home, { harness });
  const { manifest: csManifest } = stageCommunicationStylesBundle(home, { harness });
  const manifest = { files: [...aeManifest.files, ...csManifest.files] };
  installManifestFiles(manifest, bundle, harness);
  return { bundle, manifest };
}

/** Runs the manifest-driven removal path. Mirrors what `uninstall-harness.js`
 *  calls during a real uninstall. */
export function uninstallHarness(home, { harness = 'claude', manifest } = {}) {
  if (!manifest) {
    throw new Error('uninstallHarness: manifest required (pass the one returned by installFull)');
  }
  removeManifestFiles(manifest, harness);
}
