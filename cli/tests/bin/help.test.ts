import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
const execP = promisify(execFile);
const repoRoot = path.resolve(__dirname, '..', '..');

describe('radorch program wiring', () => {
  it('exposes doctor subcommand in --help (where removed)', async () => {
    const { stdout } = await execP('node', ['dist/bin/radorch.js', '--help'], {
      cwd: repoRoot,
      env: { ...process.env, RADORCH_NO_LOG: '1' },
    });
    expect(stdout).toMatch(/doctor/);
    expect(stdout).not.toMatch(/\bwhere\b/);
    expect(stdout).not.toMatch(/radorch where/);
  }, 30_000);

  it('no longer exposes a git noun in root help (git doer subcommands removed)', async () => {
    // The `git commit` / `git pr` doers were removed — the coder commits its own
    // work and the orchestrator opens PRs directly, so no `git` noun remains.
    const { stdout: rootHelp } = await execP('node', ['dist/bin/radorch.js', '--help'], {
      cwd: repoRoot, env: { ...process.env, RADORCH_NO_LOG: '1' },
    });
    expect(rootHelp).not.toMatch(/^\s*git\b/m);
  }, 30_000);

  it('exposes project noun in root help (context and find retired)', async () => {
    const node = (args: string[]) => execP('node', ['dist/bin/radorch.js', ...args], {
      cwd: repoRoot, env: { ...process.env, RADORCH_NO_LOG: '1' },
    });
    const { stdout: rootHelp } = await node(['--help']);
    expect(rootHelp).toMatch(/\bproject\b/);
    const { stdout: projectHelp } = await node(['project', '--help']);
    expect(projectHelp).not.toMatch(/context\s+Return the shared context block/);
    expect(projectHelp).not.toMatch(/find\s+Find execution-tier projects/);
  }, 30_000);

  it('exposes worktree create and worktree launch with per-agent matrix in launch help', async () => {
    const node = (args: string[]) => execP('node', ['dist/bin/radorch.js', ...args], {
      cwd: repoRoot, env: { ...process.env, RADORCH_NO_LOG: '1' },
    });
    const { stdout: rootHelp } = await node(['--help']);
    expect(rootHelp).toMatch(/\bworktree\b/);
    const { stdout: wtHelp } = await node(['worktree', '--help']);
    expect(wtHelp).toMatch(/create\s+Provision worktrees/);
    expect(wtHelp).toMatch(/launch\s+Open a terminal/);
    // (c2) remove appears alongside create/launch with its own description
    expect(wtHelp).toMatch(/remove\s+Remove worktrees/);
    const { stdout: createHelp } = await node(['worktree', 'create', '--help']);
    expect(createHelp).toMatch(/--project/);
    expect(createHelp).toMatch(/--worktree-name/);
    expect(createHelp).toMatch(/--repo/);
    const { stdout: launchHelp } = await node(['worktree', 'launch', '--help']);
    expect(launchHelp).toMatch(/--agent/);
    expect(launchHelp).toMatch(/--prompt required for: claude, copilot/);
    expect(launchHelp).toMatch(/--permission-mode only valid with: claude/);
  }, 30_000);

  it('exposes plan explode at three help depths', async () => {
    const node = (args: string[]) => execP('node', ['dist/bin/radorch.js', ...args], {
      cwd: repoRoot, env: { ...process.env, RADORCH_NO_LOG: '1' },
    });
    const { stdout: rootHelp } = await node(['--help']);
    expect(rootHelp).toMatch(/\bplan\b/);
    const { stdout: planHelp } = await node(['plan', '--help']);
    expect(planHelp).toMatch(/explode\s+Explode the Master Plan into phase and task files/);
    const { stdout: explodeHelp } = await node(['plan', 'explode', '--help']);
    expect(explodeHelp).toMatch(/--project-dir/);
    expect(explodeHelp).toMatch(/--master-plan/);
    expect(explodeHelp).toMatch(/--project-name/);
  }, 30_000);

  it('exposes plan resolve and prepare at three help depths', async () => {
    const node = (args: string[]) => execP('node', ['dist/bin/radorch.js', ...args], {
      cwd: repoRoot, env: { ...process.env, RADORCH_NO_LOG: '1' },
    });
    const { stdout: rootHelp } = await node(['--help']);
    expect(rootHelp).toMatch(/\bplan\b/);
    const { stdout: nounHelp } = await node(['plan', '--help']);
    expect(nounHelp).toMatch(/resolve\s+Classify planning readiness/);
    expect(nounHelp).toMatch(/prepare\s+Stamp planning approval/);
    const { stdout: resolveHelp } = await node(['plan', 'resolve', '--help']);
    expect(resolveHelp).toMatch(/--project/);
    const { stdout: prepareHelp } = await node(['plan', 'prepare', '--help']);
    expect(prepareHelp).toMatch(/--project/);
    expect(prepareHelp).toMatch(/--template/);
    expect(prepareHelp).toMatch(/--task-size/);
  }, 30_000);

  it('exposes amendment validate at three help depths with both option descriptions', async () => {
    const node = (args: string[]) => execP('node', ['dist/bin/radorch.js', ...args], {
      cwd: repoRoot, env: { ...process.env, RADORCH_NO_LOG: '1' },
    });
    const { stdout: rootHelp } = await node(['--help']);
    expect(rootHelp).toMatch(/\bamendment\b/);
    const { stdout: nounHelp } = await node(['amendment', '--help']);
    expect(nounHelp).toMatch(/validate\s+Validate an amendment/);
    const { stdout: validateHelp } = await node(['amendment', 'validate', '--help']);
    expect(validateHelp).toMatch(/--project-dir <value>\s+Absolute path to the project directory/);
    expect(validateHelp).toMatch(/--amendment <value>\s+Absolute path to the amendment markdown/);
  }, 30_000);

  it('exposes amendment apply and status at three help depths with their option descriptions', async () => {
    const node = (args: string[]) => execP('node', ['dist/bin/radorch.js', ...args], {
      cwd: repoRoot, env: { ...process.env, RADORCH_NO_LOG: '1' },
    });
    const { stdout: nounHelp } = await node(['amendment', '--help']);
    expect(nounHelp).toMatch(/apply\s+Apply an amendment/);
    expect(nounHelp).toMatch(/status\s+Report what an amendment may legally do/);
    const { stdout: applyHelp } = await node(['amendment', 'apply', '--help']);
    expect(applyHelp).toMatch(/--project-dir <value>\s+Absolute path to the project directory/);
    expect(applyHelp).toMatch(/--amendment <value>\s+Absolute path to the amendment markdown/);
    const { stdout: statusHelp } = await node(['amendment', 'status', '--help']);
    expect(statusHelp).toMatch(/--project-dir <value>\s+Absolute path to the project directory/);
  }, 30_000);

  it('exposes skill list at three help depths', async () => {
    const node = (args: string[]) => execP('node', ['dist/bin/radorch.js', ...args], {
      cwd: repoRoot, env: { ...process.env, RADORCH_NO_LOG: '1' },
    });
    const { stdout: rootHelp } = await node(['--help']);
    expect(rootHelp).toMatch(/\bskill\b/);
    const { stdout: skillHelp } = await node(['skill', '--help']);
    // Commander wraps the description across a line break at this column width —
    // tolerate the wrap point rather than pinning to a single unwrapped line.
    expect(skillHelp).toMatch(/list\s+List repository SKILL\.md entries eligible for planner-spawn\s+discovery/);
    const { stdout: listHelp } = await node(['skill', 'list', '--help']);
    expect(listHelp).toMatch(/--repo <value>\s+Registered repo name\(s\) to scan; comma-separated[\s\S]+several/);
    expect(listHelp).toMatch(/--repo-group <value>\s+Registered repo-group name\(s\) whose members are scanned;[\s\S]+comma-separated/);
  }, 30_000);

  it('exposes repo-group subcommands at three help depths', async () => {
    const node = (args: string[]) => execP('node', ['dist/bin/radorch.js', ...args], {
      cwd: repoRoot, env: { ...process.env, RADORCH_NO_LOG: '1' },
    });
    const { stdout: rootHelp } = await node(['--help']);
    expect(rootHelp).toMatch(/\brepo-group\b/);
    const { stdout: rgHelp } = await node(['repo-group', '--help']);
    expect(rgHelp).toMatch(/create\s+Create a repo-group/);
    expect(rgHelp).toMatch(/add\s+Add a registered repo to a repo-group/);
    expect(rgHelp).toMatch(/remove\s+Remove a repo from a repo-group/);
    expect(rgHelp).toMatch(/delete\s+Delete a repo-group/);
    expect(rgHelp).toMatch(/list\s+List all repo-groups/);
    expect(rgHelp).toMatch(/show\s+Show description and members/);
    expect(rgHelp).toMatch(/edit\s+Edit a repo-group/);
    const { stdout: createHelp } = await node(['repo-group', 'create', '--help']);
    expect(createHelp).toMatch(/--name/);
    expect(createHelp).toMatch(/--members/);
  }, 30_000);

  it('exposes session at three help depths, coexisting with session-context', async () => {
    const node = (args: string[]) => execP('node', ['dist/bin/radorch.js', ...args], {
      cwd: repoRoot, env: { ...process.env, RADORCH_NO_LOG: '1' },
    });
    const { stdout: rootHelp } = await node(['--help']);
    expect(rootHelp).toMatch(/\bsession\b/);
    expect(rootHelp).toMatch(/\bsession-context\b/);

    const { stdout: sessionHelp } = await node(['session', '--help']);
    expect(sessionHelp).toMatch(/save/);
    expect(sessionHelp).toMatch(/list/);
    expect(sessionHelp).toMatch(/resume/);
    // session's own --help does not fold in session-context's subcommands or vice versa
    expect(sessionHelp).not.toMatch(/Rendered session preamble/);

    const { stdout: saveHelp } = await node(['session', 'save', '--help']);
    expect(saveHelp).toMatch(/--project/);
    expect(saveHelp).toMatch(/--session/);
    expect(saveHelp).toMatch(/--harness/);

    const { stdout: listHelp } = await node(['session', 'list', '--help']);
    expect(listHelp).toMatch(/--project/);
    expect(listHelp).toMatch(/--limit/);
    expect(listHelp).toMatch(/--all/);

    const { stdout: resumeHelp } = await node(['session', 'resume', '--help']);
    expect(resumeHelp).toMatch(/--session/);
    expect(resumeHelp).toMatch(/--harness/);
  }, 30_000);

  it('exposes session-context in root help and with description in its own --help', async () => {
    const node = (args: string[]) => execP('node', ['dist/bin/radorch.js', ...args], {
      cwd: repoRoot, env: { ...process.env, RADORCH_NO_LOG: '1' },
    });
    const { stdout: rootHelp } = await node(['--help']);
    expect(rootHelp).toMatch(/\bsession-context\b/);
    const { stdout: scHelp } = await node(['session-context', '--help']);
    expect(scHelp).toMatch(/Rendered session preamble/);
  }, 30_000);

  it('exposes pipeline signal at three help depths', async () => {
    const node = (args: string[]) => execP('node', ['dist/bin/radorch.js', ...args], {
      cwd: repoRoot, env: { ...process.env, RADORCH_NO_LOG: '1' },
    });
    const { stdout: rootHelp } = await node(['--help']);
    expect(rootHelp).toMatch(/\bpipeline\b/);
    const { stdout: pipelineHelp } = await node(['pipeline', '--help']);
    expect(pipelineHelp).toMatch(/signal\s+Signal a pipeline event/);
    const { stdout: signalHelp } = await node(['pipeline', 'signal', '--help']);
    expect(signalHelp).toMatch(/--event/);
    expect(signalHelp).toMatch(/--project-dir/);
    expect(signalHelp).toMatch(/--doc-path/);
    expect(signalHelp).toMatch(/--parse-error/);
    expect(signalHelp).toMatch(/--verdict/);
    expect(signalHelp).toMatch(/--gate-type/);
    expect(signalHelp).toMatch(/--gate-mode/);
  }, 30_000);

  it('exposes side-project init at three help depths', async () => {
    const node = (args: string[]) => execP('node', ['dist/bin/radorch.js', ...args], {
      cwd: repoRoot, env: { ...process.env, RADORCH_NO_LOG: '1' },
    });
    const { stdout: rootHelp } = await node(['--help']);
    expect(rootHelp).toMatch(/side-project/);
    const { stdout: nounHelp } = await node(['side-project', '--help']);
    expect(nounHelp).toMatch(/init\s+Provision a local-only side-project git repo/);
    const { stdout: initHelp } = await node(['side-project', 'init', '--help']);
    expect(initHelp).toMatch(/--project/);
  }, 30_000);

  it('exposes source-control init at three help depths', async () => {
    const node = (args: string[]) => execP('node', ['dist/bin/radorch.js', ...args], {
      cwd: repoRoot, env: { ...process.env, RADORCH_NO_LOG: '1' },
    });
    const { stdout: rootHelp } = await node(['--help']);
    expect(rootHelp).toMatch(/source-control/);
    // (c3) noun depth: source-control --help shows init with its description
    const { stdout: nounHelp } = await node(['source-control', '--help']);
    expect(nounHelp).toMatch(/init\s+Validate worktrees and record source-control state/);
    const { stdout: initHelp } = await node(['source-control', 'init', '--help']);
    expect(initHelp).toMatch(/--project/);
  }, 30_000);

  it('exposes execute resolve and prepare at three help depths', async () => {
    const node = (args: string[]) => execP('node', ['dist/bin/radorch.js', ...args], {
      cwd: repoRoot, env: { ...process.env, RADORCH_NO_LOG: '1' },
    });
    const { stdout: rootHelp } = await node(['--help']);
    expect(rootHelp).toMatch(/\bexecute\b/);
    const { stdout: nounHelp } = await node(['execute', '--help']);
    expect(nounHelp).toMatch(/resolve\s+Classify the run mode/);
    expect(nounHelp).toMatch(/prepare\s+Provision worktrees and seal/);
    const { stdout: resolveHelp } = await node(['execute', 'resolve', '--help']);
    expect(resolveHelp).toMatch(/--project/);
    const { stdout: prepareHelp } = await node(['execute', 'prepare', '--help']);
    expect(prepareHelp).toMatch(/--project/);
    expect(prepareHelp).toMatch(/--auto-commit/);
    expect(prepareHelp).toMatch(/--auto-pr/);
  }, 30_000);

  it('exposes project list, show, and worktrees subcommands at three help depths', async () => {
    const node = (args: string[]) => execP('node', ['dist/bin/radorch.js', ...args], {
      cwd: repoRoot, env: { ...process.env, RADORCH_NO_LOG: '1' },
    });
    // noun depth: project --help lists all read verbs with their descriptions
    const { stdout: projectHelp } = await node(['project', '--help']);
    expect(projectHelp).toMatch(/list\s+List projects/);
    expect(projectHelp).toMatch(/show\s+Show one project/);
    expect(projectHelp).toMatch(/worktrees\s+Show a project/);
    // (c1) locate appears alongside list/show/worktrees with its own description
    expect(projectHelp).toMatch(/locate\s+Classify the current working directory/);
    // verb depth: project list --help exposes --status and --group flags
    const { stdout: listHelp } = await node(['project', 'list', '--help']);
    expect(listHelp).toMatch(/--status/);
    expect(listHelp).toMatch(/--group/);
    // verb depth: project show --help exposes the id option and its description
    const { stdout: showHelp } = await node(['project', 'show', '--help']);
    expect(showHelp).toMatch(/--id/);
    expect(showHelp).toMatch(/Project id \(folder name\) to show/);
    // verb depth: project worktrees --help exposes the id option and its description
    const { stdout: worktreesHelp } = await node(['project', 'worktrees', '--help']);
    expect(worktreesHelp).toMatch(/--id/);
    expect(worktreesHelp).toMatch(/Project id \(folder name\) whose worktrees to resolve/);
  }, 30_000);

  it('exposes project-group verbs at three help depths', async () => {
    const node = (args: string[]) => execP('node', ['dist/bin/radorch.js', ...args], { cwd: repoRoot, env: { ...process.env, RADORCH_NO_LOG: '1' } });
    const { stdout: rootHelp } = await node(['--help']);
    expect(rootHelp).toMatch(/\bproject-group\b/);
    const { stdout: pgHelp } = await node(['project-group', '--help']);
    expect(pgHelp).toMatch(/create\s+Create a project-group/);
    expect(pgHelp).toMatch(/add\s+Add a project or sub-group/);
    const { stdout: createHelp } = await node(['project-group', 'create', '--help']);
    expect(createHelp).toMatch(/--description/);
  }, 30_000);

  it('exposes portfolio list and show at three help depths', async () => {
    const node = (args: string[]) => execP('node', ['dist/bin/radorch.js', ...args], { cwd: repoRoot, env: { ...process.env, RADORCH_NO_LOG: '1' } });
    const { stdout: rootHelp } = await node(['--help']);
    expect(rootHelp).toMatch(/\bportfolio\b/);
    const { stdout: portfolioHelp } = await node(['portfolio', '--help']);
    expect(portfolioHelp).toMatch(/list\s+List portfolios/);
    expect(portfolioHelp).toMatch(/show\s+Show one portfolio/);
    expect(portfolioHelp).toMatch(/create\s+Create a portfolio/);
    expect(portfolioHelp).toMatch(/provision\s+Provision a portfolio iteration/);
    const { stdout: listHelp } = await node(['portfolio', 'list', '--help']);
    expect(listHelp).toMatch(/--status <value>\s+Filter by lifecycle status: active, on-hold, or done/);
    const { stdout: showHelp } = await node(['portfolio', 'show', '--help']);
    expect(showHelp).toMatch(/--portfolio <value>\s+Portfolio base name or its group name\/id/);
    const { stdout: createHelp } = await node(['portfolio', 'create', '--help']);
    expect(createHelp).toMatch(/--portfolio <value>\s+Portfolio base name, SCREAMING-CASE/);
    expect(createHelp).toMatch(/--description <value>\s+One sentence on what this initiative is for/);
    const { stdout: provisionHelp } = await node(['portfolio', 'provision', '--help']);
    expect(provisionHelp).toMatch(/--portfolio <value>\s+Portfolio base name or its group name\/id/);
    expect(provisionHelp).toMatch(/--iteration <value>\s+The iteration's project id, not its human-readable name/);
    expect(provisionHelp).toMatch(/--depends-on <value>\s+Comma-separated project ids this one depends on, not/);
  }, 30_000);

  it('exposes graph verbs with rich link leaf help at three depths', async () => {
    const node = (args: string[]) => execP('node', ['dist/bin/radorch.js', ...args], { cwd: repoRoot, env: { ...process.env, RADORCH_NO_LOG: '1' } });
    const { stdout: rootHelp } = await node(['--help']);
    expect(rootHelp).toMatch(/\bgraph\b/);
    const { stdout: graphHelp } = await node(['graph', '--help']);
    expect(graphHelp).toMatch(/link\s+Add a relationship edge/);
    expect(graphHelp).toMatch(/prune\s+/);
    const { stdout: linkHelp } = await node(['graph', 'link', '--help']);
    expect(linkHelp).toMatch(/spawned-from/);
    expect(linkHelp).toMatch(/depends-on/);
    expect(linkHelp).toMatch(/decoration/);
    const { stdout: unlinkHelp } = await node(['graph', 'unlink', '--help']);
    expect(unlinkHelp).toMatch(/spawned-from/);
    expect(unlinkHelp).toMatch(/depends-on/);
    expect(unlinkHelp).toMatch(/decoration/);
  }, 30_000);

  it('project noun retires context and keeps show/list/worktrees/locate (FR-24)', async () => {
    const { stdout: projectHelp } = await execP('node', ['dist/bin/radorch.js', 'project', '--help'], {
      cwd: repoRoot,
      env: { ...process.env, RADORCH_NO_LOG: '1' },
    });
    expect(projectHelp).not.toMatch(/\bcontext\b/);
    expect(projectHelp).toMatch(/\bshow\b/);
    expect(projectHelp).toMatch(/\blocate\b/);
  }, 30_000);

  it('exposes migrate in root help and responds to its own --help with safety-rail flags', async () => {
    const node = (args: string[]) => execP('node', ['dist/bin/radorch.js', ...args], {
      cwd: repoRoot, env: { ...process.env, RADORCH_NO_LOG: '1' },
    });
    const { stdout: rootHelp } = await node(['--help']);
    expect(rootHelp).toMatch(/\bmigrate\b/);
    // Commander wraps this description across a line break once a longer sibling
    // command name (e.g. communication-style) widens the help column — tolerate
    // the wrap point rather than pinning to a single unwrapped line.
    expect(rootHelp).toMatch(/migrate\s+Migrate a project state\.json to the current schema\s+version/);
    const { stdout: migrateHelp } = await node(['migrate', '--help']);
    expect(migrateHelp).toMatch(/--project/);
    expect(migrateHelp).toMatch(/--all/);
    expect(migrateHelp).toMatch(/--dry-run/);
  }, 30_000);
});
