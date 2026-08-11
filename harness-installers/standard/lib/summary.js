// harness-installers/standard/lib/summary.js — Post-install summary
// renderer for the standard installer. Mirrors the legacy installer's text
// style (THEME tokens, BBS-style section headers, numbered next-steps) but
// works from the new harness-aware structure produced by index.js.
//
// Surface order (DD-2):
//   1. Section: ::: Installation Complete
//      ├─ one line per harness (action-aware: fresh-install | upgrade-complete
//      │  | noop → green check; downgrade-refused → red X)
//      ├─ Configuration: <orchYmlPath>
//      └─ Dashboard UI: built and ready
//   2. Section: ::: What's Next
//      ├─ /rad-brainstorm
//      ├─ /rad-plan
//      ├─ /rad-execute
//      └─ /rad-ui-start
//   3. Full-guide link.
//   4. (DD-4 — diagnostic): drift hint emitted on stderr if `driftHint` is truthy.

import { THEME, sectionHeader, divider } from './theme.js';
import { harnessRoot } from './install/harness-paths.js';
import { userDataPaths } from './install/user-data-paths.js';

/**
 * @typedef {Object} HarnessResult
 * @property {string} harness - Harness key (claude / copilot-vscode / copilot-cli)
 * @property {'fresh-install' | 'upgrade-complete' | 'noop' | 'downgrade-refused' | 'failed'} action
 * @property {string} [message] - Optional message (typically set on downgrade-refused or failed)
 */

/**
 * Renders the post-install summary to stdout. The drift hint, if present, is
 * emitted on stderr per DD-4 (diagnostics go to stderr; user-facing summary
 * stays on stdout).
 *
 * @param {{
 *   harnessResults: HarnessResult[],
 *   configPath: string,
 *   driftHint?: { installedVersion: string, pluginVersion: string } | boolean | null,
 *   uiBuilt?: boolean,
 *   uiStopped?: boolean,
 * }} opts
 * @returns {void}
 */
export function renderPostInstallSummary({ harnessResults, configPath, driftHint, uiBuilt, uiStopped }) {
  const paths = userDataPaths();

  console.log('');
  sectionHeader('::', 'Installation Complete');
  console.log('');

  for (const r of harnessResults) {
    const isError = r.action === 'downgrade-refused' || r.action === 'failed';
    const mark = isError ? THEME.error('✖') : THEME.success('✔');
    let verb;
    if (r.action === 'downgrade-refused') verb = 'install refused';
    else if (r.action === 'failed') verb = 'install failed';
    else verb = 'bootstrapped';
    console.log(
      '  ' + mark + ' ' +
      THEME.body(`harness '${r.harness}' ${verb} (action: ${r.action})`),
    );
    if (!isError) {
      try {
        const installRoot = harnessRoot(r.harness);
        console.log('      ' + THEME.secondary('Installed to  ') + THEME.command(installRoot));
      } catch {
        /* unknown harness key — skip the path line silently */
      }
    }
  }

  console.log('');
  console.log('  ' + THEME.success('✔') + ' ' + THEME.body('Workspace     ') + THEME.command(paths.root));
  console.log('      ' + THEME.secondary('Configuration ') + THEME.command(configPath));
  console.log('      ' + THEME.secondary('Projects      ') + THEME.command(paths.projects));

  if (uiBuilt) {
    console.log('');
    console.log('  ' + THEME.success('✔') + ' ' + THEME.body('Dashboard UI built and ready'));
    if (uiStopped) {
      console.log('      ' + THEME.secondary('(The running dashboard UI was stopped to apply this update — restart it with `rad-orc ui-start`.)'));
    }
  }

  console.log('');
  sectionHeader('::', "What's Next");
  console.log('');

  console.log('  ' + THEME.stepNumber('1.') + ' ' + THEME.body('Open your harness and start a new conversation.'));
  console.log('');

  console.log('  ' + THEME.stepNumber('2.') + ' ' + THEME.body('Walk through the orchestration workflow:'));
  console.log('');
  console.log('     ' + THEME.command('/rad-brainstorm') + '  →  ' + THEME.body('refine a project idea'));
  console.log('     ' + THEME.command('/rad-plan') + '        →  ' + THEME.body('produce requirements + master plan'));
  console.log('     ' + THEME.command('/rad-execute') + '     →  ' + THEME.body('run the pipeline through implementation'));
  console.log('');

  console.log('  ' + THEME.stepNumber('3.') + ' ' + THEME.body('(optional) Start the dashboard from inside your harness:'));
  console.log('');
  console.log('     ' + THEME.command('/rad-ui-start'));
  console.log('');

  console.log('  ' + THEME.body('Full guide: ') + THEME.command('https://github.com/MetalHexx/RadOrchestration/blob/main/docs/getting-started.md'));
  console.log('');

  divider();

  if (driftHint) {
    // DD-4: drift line is diagnostic — emit on stderr, not stdout.
    let line;
    if (typeof driftHint === 'object' && driftHint.installedVersion && driftHint.pluginVersion) {
      line = `[drift] run /plugin update rad-orchestration to sync (plugin v${driftHint.pluginVersion}, standard v${driftHint.installedVersion})\n`;
    } else {
      line = '[drift] run /plugin update rad-orchestration to sync\n';
    }
    process.stderr.write(line);
  }
}

const HARNESS_DISPLAY_NAME = {
  'claude':                'Claude Code',
  'claude-plugin':         'Claude Code (plugin)',
  'copilot-vscode':        'Copilot VS Code',
  'copilot-vscode-plugin': 'Copilot VS Code (plugin)',
  'copilot-cli':           'Copilot CLI',
  'copilot-cli-plugin':    'Copilot CLI (plugin)',
};

/**
 * Renders the post-uninstall summary. Mirrors `renderPostInstallSummary`'s
 * shape so the two flows feel cohesive: section header, the removed harness
 * with file and directory counts, a "Remaining harnesses" block read fresh
 * from `install.json`, and the workspace block with `(preserved)` suffixes
 * that make the safety contract visible at a glance.
 *
 * @param {{
 *   harness: string,
 *   removedVersion: string,
 *   removedCount: number,
 *   prunedDirs: number,
 *   remainingHarnesses: Record<string, { version: string }>,
 *   configPath: string,
 * }} opts
 * @returns {void}
 */
export function renderUninstallSummary({
  harness,
  removedVersion,
  removedCount,
  prunedDirs,
  remainingHarnesses,
  configPath,
}) {
  const paths = userDataPaths();

  console.log('');
  sectionHeader('::', 'Uninstall Complete');
  console.log('');

  console.log(
    '  ' + THEME.success('✔') + ' ' +
    THEME.body(`Uninstalled '${harness}' (v${removedVersion})`),
  );
  try {
    const installRoot = harnessRoot(harness);
    console.log('      ' + THEME.secondary('Removed from  ') + THEME.command(installRoot));
  } catch {
    /* unknown harness key — skip path line silently */
  }
  const filesWord = removedCount === 1 ? 'file' : 'files';
  const dirsWord = prunedDirs === 1 ? 'directory' : 'directories';
  console.log(
    '      ' + THEME.secondary(`${removedCount} ${filesWord} removed, ${prunedDirs} empty ${dirsWord} pruned`),
  );

  console.log('');
  const remainingEntries = Object.entries(remainingHarnesses);
  if (remainingEntries.length > 0) {
    console.log('  ' + THEME.label('Remaining harnesses'));
    console.log('');
    const rows = remainingEntries
      .map(([key, entry]) => ({
        name: HARNESS_DISPLAY_NAME[key] ?? key,
        version: entry.version,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const nameCol = Math.max(...rows.map((r) => r.name.length)) + 4;
    for (const r of rows) {
      console.log(`    ${THEME.body(r.name.padEnd(nameCol, ' '))}${THEME.secondary('v' + r.version)}`);
    }
  } else {
    console.log('  ' + THEME.label('Remaining harnesses'));
    console.log('');
    console.log('    ' + THEME.hint('(none — workspace is preserved and ready for a future install)'));
  }

  console.log('');
  console.log(
    '  ' + THEME.success('✔') + ' ' +
    THEME.body('Workspace     ') + THEME.command(paths.root) + '  ' + THEME.secondary('(preserved)'),
  );
  console.log(
    '      ' + THEME.secondary('Configuration ') + THEME.command(configPath) + '  ' + THEME.secondary('(preserved)'),
  );
  console.log(
    '      ' + THEME.secondary('Projects      ') + THEME.command(paths.projects) + '  ' + THEME.secondary('(preserved)'),
  );

  console.log('');
  divider();
}
