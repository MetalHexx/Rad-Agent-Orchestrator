import { Command } from 'commander';
import { runCommand } from './framework/command.js';
import { doctorCommand } from './commands/doctor/index.js';
import { uiStartCommand, uiStopCommand, uiStatusCommand } from './commands/ui/index.js';
import { repoAddCommand, repoBindCommand, repoEditCommand, repoListCommand, repoRemoveCommand, repoShowCommand } from './commands/repo/index.js';
import { projectListCommand, projectLocateCommand, projectShowCommand, projectWorktreesCommand } from './commands/project/index.js';
import { worktreeCreateCommand, worktreeLaunchCommand, worktreeRemoveCommand } from './commands/worktree/index.js';
import { sideProjectInitCommand } from './commands/side-project/index.js';
import { planExplodeCommand, planResolveCommand } from './commands/plan/index.js';
import { migrateCommand } from './commands/migrate/index.js';
import { skillListCommand } from './commands/skill/index.js';
import { pipelineSignalCommand } from './commands/pipeline/index.js';
import { groupCreateCommand, groupEditCommand, groupAddCommand, groupRemoveCommand, groupDeleteCommand, groupListCommand, groupShowCommand } from './commands/repo-group/index.js';
import { groupCreateCommand as pgGroupCreateCommand, groupEditCommand as pgGroupEditCommand, groupAddCommand as pgGroupAddCommand, groupRemoveCommand as pgGroupRemoveCommand, groupDeleteCommand as pgGroupDeleteCommand, groupListCommand as pgGroupListCommand, groupShowCommand as pgGroupShowCommand } from './commands/project-group/index.js';
import { sessionContextCommand } from './commands/session-context/index.js';
import { graphShowCommand, graphLinkCommand, graphUnlinkCommand, graphPruneCommand } from './commands/graph/index.js';
import { configCommand } from './commands/config/index.js';
import { sourceControlInitCommand } from './commands/source-control/index.js';
import { executeResolveCommand, executePrepareCommand } from './commands/execute/index.js';
import { telemetryCaptureCommand } from './commands/telemetry/index.js';

export function buildProgram(version: string): Command {
  const program = new Command('radorch');
  program.description('radorch CLI — global orchestration root manager').version(version);

  program
    .command('doctor')
    .description(doctorCommand.description)
    .allowUnknownOption()
    .allowExcessArguments(true)
    .action(async () => {
      const argv = process.argv.slice(3);
      await runCommand(doctorCommand, { argv, env: process.env, isTTY: Boolean(process.stdin.isTTY), stderr: process.stderr });
    });

  program
    .command('session-context')
    .description(sessionContextCommand.description)
    .allowUnknownOption()
    .allowExcessArguments(true)
    .action(async () => {
      const argv = process.argv.slice(3);
      await runCommand(sessionContextCommand, { argv, env: process.env, isTTY: Boolean(process.stdin.isTTY), stderr: process.stderr });
    });

  program
    .command('config')
    .description(configCommand.description)
    .allowUnknownOption()
    .allowExcessArguments(true)
    .action(async () => {
      const argv = process.argv.slice(3);
      await runCommand(configCommand, { argv, env: process.env, isTTY: Boolean(process.stdin.isTTY), stderr: process.stderr });
    });

  const ui = program.command('ui').description('UI server lifecycle');
  ui
    .command('start')
    .description(uiStartCommand.description)
    .allowUnknownOption()
    .allowExcessArguments(true)
    .action(async () => {
      const argv = process.argv.slice(4);
      await runCommand(uiStartCommand, { argv, env: process.env, isTTY: Boolean(process.stdin.isTTY), stderr: process.stderr });
    });
  ui
    .command('stop')
    .description(uiStopCommand.description)
    .allowUnknownOption()
    .allowExcessArguments(true)
    .action(async () => {
      const argv = process.argv.slice(4);
      await runCommand(uiStopCommand, { argv, env: process.env, isTTY: Boolean(process.stdin.isTTY), stderr: process.stderr });
    });
  ui
    .command('status')
    .description(uiStatusCommand.description)
    .allowUnknownOption()
    .allowExcessArguments(true)
    .action(async () => {
      const argv = process.argv.slice(4);
      await runCommand(uiStatusCommand, { argv, env: process.env, isTTY: Boolean(process.stdin.isTTY), stderr: process.stderr });
    });

  const repo = program.command('repo').description('Repo registry operations');
  repo
    .command('add')
    .description(repoAddCommand.description)
    .helpOption(false)
    .allowUnknownOption()
    .allowExcessArguments(true)
    .action(async () => {
      const argv = process.argv.slice(4);
      await runCommand(repoAddCommand, { argv, env: process.env, isTTY: Boolean(process.stdin.isTTY), stderr: process.stderr });
    });
  repo
    .command('bind')
    .description(repoBindCommand.description)
    .helpOption(false)
    .allowUnknownOption()
    .allowExcessArguments(true)
    .action(async () => {
      const argv = process.argv.slice(4);
      await runCommand(repoBindCommand, { argv, env: process.env, isTTY: Boolean(process.stdin.isTTY), stderr: process.stderr });
    });
  repo
    .command('list')
    .description(repoListCommand.description)
    .helpOption(false)
    .allowUnknownOption()
    .allowExcessArguments(true)
    .action(async () => {
      const argv = process.argv.slice(4);
      await runCommand(repoListCommand, { argv, env: process.env, isTTY: Boolean(process.stdin.isTTY), stderr: process.stderr });
    });
  repo
    .command('show')
    .description(repoShowCommand.description)
    .helpOption(false)
    .allowUnknownOption()
    .allowExcessArguments(true)
    .action(async () => {
      const argv = process.argv.slice(4);
      await runCommand(repoShowCommand, { argv, env: process.env, isTTY: Boolean(process.stdin.isTTY), stderr: process.stderr });
    });
  repo
    .command('edit')
    .description(repoEditCommand.description)
    .helpOption(false)
    .allowUnknownOption()
    .allowExcessArguments(true)
    .action(async () => {
      const argv = process.argv.slice(4);
      await runCommand(repoEditCommand, { argv, env: process.env, isTTY: Boolean(process.stdin.isTTY), stderr: process.stderr });
    });
  repo
    .command('remove')
    .description(repoRemoveCommand.description)
    .helpOption(false)
    .allowUnknownOption()
    .allowExcessArguments(true)
    .action(async () => {
      const argv = process.argv.slice(4);
      await runCommand(repoRemoveCommand, { argv, env: process.env, isTTY: Boolean(process.stdin.isTTY), stderr: process.stderr });
    });

  const repoGroup = program.command('repo-group').description('Repo-group registry operations');
  repoGroup
    .command('create')
    .description(groupCreateCommand.description)
    .helpOption(false)
    .allowUnknownOption()
    .allowExcessArguments(true)
    .action(async () => {
      const argv = process.argv.slice(4);
      await runCommand(groupCreateCommand, { argv, env: process.env, isTTY: Boolean(process.stdin.isTTY), stderr: process.stderr });
    });
  repoGroup
    .command('add')
    .description(groupAddCommand.description)
    .helpOption(false)
    .allowUnknownOption()
    .allowExcessArguments(true)
    .action(async () => {
      const argv = process.argv.slice(4);
      await runCommand(groupAddCommand, { argv, env: process.env, isTTY: Boolean(process.stdin.isTTY), stderr: process.stderr });
    });
  repoGroup
    .command('remove')
    .description(groupRemoveCommand.description)
    .helpOption(false)
    .allowUnknownOption()
    .allowExcessArguments(true)
    .action(async () => {
      const argv = process.argv.slice(4);
      await runCommand(groupRemoveCommand, { argv, env: process.env, isTTY: Boolean(process.stdin.isTTY), stderr: process.stderr });
    });
  repoGroup
    .command('delete')
    .description(groupDeleteCommand.description)
    .helpOption(false)
    .allowUnknownOption()
    .allowExcessArguments(true)
    .action(async () => {
      const argv = process.argv.slice(4);
      await runCommand(groupDeleteCommand, { argv, env: process.env, isTTY: Boolean(process.stdin.isTTY), stderr: process.stderr });
    });
  repoGroup
    .command('list')
    .description(groupListCommand.description)
    .helpOption(false)
    .allowUnknownOption()
    .allowExcessArguments(true)
    .action(async () => {
      const argv = process.argv.slice(4);
      await runCommand(groupListCommand, { argv, env: process.env, isTTY: Boolean(process.stdin.isTTY), stderr: process.stderr });
    });
  repoGroup
    .command('show')
    .description(groupShowCommand.description)
    .helpOption(false)
    .allowUnknownOption()
    .allowExcessArguments(true)
    .action(async () => {
      const argv = process.argv.slice(4);
      await runCommand(groupShowCommand, { argv, env: process.env, isTTY: Boolean(process.stdin.isTTY), stderr: process.stderr });
    });
  repoGroup
    .command('edit')
    .description(groupEditCommand.description)
    .helpOption(false)
    .allowUnknownOption()
    .allowExcessArguments(true)
    .action(async () => {
      const argv = process.argv.slice(4);
      await runCommand(groupEditCommand, { argv, env: process.env, isTTY: Boolean(process.stdin.isTTY), stderr: process.stderr });
    });

  const projectGroup = program.command('project-group').description('Project-group structure operations');
  projectGroup
    .command('create')
    .description(pgGroupCreateCommand.description)
    .helpOption(false)
    .allowUnknownOption()
    .allowExcessArguments(true)
    .action(async () => {
      const argv = process.argv.slice(4);
      await runCommand(pgGroupCreateCommand, { argv, env: process.env, isTTY: Boolean(process.stdin.isTTY), stderr: process.stderr });
    });
  projectGroup
    .command('add')
    .description(pgGroupAddCommand.description)
    .helpOption(false)
    .allowUnknownOption()
    .allowExcessArguments(true)
    .action(async () => {
      const argv = process.argv.slice(4);
      await runCommand(pgGroupAddCommand, { argv, env: process.env, isTTY: Boolean(process.stdin.isTTY), stderr: process.stderr });
    });
  projectGroup
    .command('remove')
    .description(pgGroupRemoveCommand.description)
    .helpOption(false)
    .allowUnknownOption()
    .allowExcessArguments(true)
    .action(async () => {
      const argv = process.argv.slice(4);
      await runCommand(pgGroupRemoveCommand, { argv, env: process.env, isTTY: Boolean(process.stdin.isTTY), stderr: process.stderr });
    });
  projectGroup
    .command('delete')
    .description(pgGroupDeleteCommand.description)
    .helpOption(false)
    .allowUnknownOption()
    .allowExcessArguments(true)
    .action(async () => {
      const argv = process.argv.slice(4);
      await runCommand(pgGroupDeleteCommand, { argv, env: process.env, isTTY: Boolean(process.stdin.isTTY), stderr: process.stderr });
    });
  projectGroup
    .command('list')
    .description(pgGroupListCommand.description)
    .helpOption(false)
    .allowUnknownOption()
    .allowExcessArguments(true)
    .action(async () => {
      const argv = process.argv.slice(4);
      await runCommand(pgGroupListCommand, { argv, env: process.env, isTTY: Boolean(process.stdin.isTTY), stderr: process.stderr });
    });
  projectGroup
    .command('show')
    .description(pgGroupShowCommand.description)
    .helpOption(false)
    .allowUnknownOption()
    .allowExcessArguments(true)
    .action(async () => {
      const argv = process.argv.slice(4);
      await runCommand(pgGroupShowCommand, { argv, env: process.env, isTTY: Boolean(process.stdin.isTTY), stderr: process.stderr });
    });
  projectGroup
    .command('edit')
    .description(pgGroupEditCommand.description)
    .helpOption(false)
    .allowUnknownOption()
    .allowExcessArguments(true)
    .action(async () => {
      const argv = process.argv.slice(4);
      await runCommand(pgGroupEditCommand, { argv, env: process.env, isTTY: Boolean(process.stdin.isTTY), stderr: process.stderr });
    });

  const graph = program.command('graph').description('Work-graph structure, relationships, and upkeep');
  graph
    .command('show')
    .description(graphShowCommand.description)
    .helpOption(false)
    .allowUnknownOption()
    .allowExcessArguments(true)
    .action(async () => {
      const argv = process.argv.slice(4);
      await runCommand(graphShowCommand, { argv, env: process.env, isTTY: Boolean(process.stdin.isTTY), stderr: process.stderr });
    });
  graph
    .command('link')
    .description(graphLinkCommand.description)
    .helpOption(false)
    .allowUnknownOption()
    .allowExcessArguments(true)
    .action(async () => {
      const argv = process.argv.slice(4);
      await runCommand(graphLinkCommand, { argv, env: process.env, isTTY: Boolean(process.stdin.isTTY), stderr: process.stderr });
    });
  graph
    .command('unlink')
    .description(graphUnlinkCommand.description)
    .helpOption(false)
    .allowUnknownOption()
    .allowExcessArguments(true)
    .action(async () => {
      const argv = process.argv.slice(4);
      await runCommand(graphUnlinkCommand, { argv, env: process.env, isTTY: Boolean(process.stdin.isTTY), stderr: process.stderr });
    });
  graph
    .command('prune')
    .description(graphPruneCommand.description)
    .helpOption(false)
    .allowUnknownOption()
    .allowExcessArguments(true)
    .action(async () => {
      const argv = process.argv.slice(4);
      await runCommand(graphPruneCommand, { argv, env: process.env, isTTY: Boolean(process.stdin.isTTY), stderr: process.stderr });
    });

  const project = program.command('project').description('Project state read operations');
  project
    .command('list')
    .description(projectListCommand.description)
    .helpOption(false)
    .allowUnknownOption()
    .allowExcessArguments(true)
    .action(async () => {
      const argv = process.argv.slice(4);
      await runCommand(projectListCommand, { argv, env: process.env, isTTY: Boolean(process.stdin.isTTY), stderr: process.stderr });
    });
  project
    .command('show')
    .description(projectShowCommand.description)
    .helpOption(false)
    .allowUnknownOption()
    .allowExcessArguments(true)
    .action(async () => {
      const argv = process.argv.slice(4);
      await runCommand(projectShowCommand, { argv, env: process.env, isTTY: Boolean(process.stdin.isTTY), stderr: process.stderr });
    });
  project
    .command('locate')
    .description(projectLocateCommand.description)
    .helpOption(false)
    .allowUnknownOption()
    .allowExcessArguments(true)
    .action(async () => {
      const argv = process.argv.slice(4);
      await runCommand(projectLocateCommand, { argv, env: process.env, isTTY: Boolean(process.stdin.isTTY), stderr: process.stderr });
    });
  project
    .command('worktrees')
    .description(projectWorktreesCommand.description)
    .helpOption(false)
    .allowUnknownOption()
    .allowExcessArguments(true)
    .action(async () => {
      const argv = process.argv.slice(4);
      await runCommand(projectWorktreesCommand, { argv, env: process.env, isTTY: Boolean(process.stdin.isTTY), stderr: process.stderr });
    });

  const worktree = program.command('worktree').description('Worktree lifecycle operations');
  worktree
    .command('create')
    .description(worktreeCreateCommand.description)
    .helpOption(false)
    .allowUnknownOption()
    .allowExcessArguments(true)
    .action(async () => {
      const argv = process.argv.slice(4);
      await runCommand(worktreeCreateCommand, { argv, env: process.env, isTTY: Boolean(process.stdin.isTTY), stderr: process.stderr });
    });
  worktree
    .command('launch')
    .description(worktreeLaunchCommand.description)
    .helpOption(false)
    .allowUnknownOption()
    .allowExcessArguments(true)
    .action(async () => {
      const argv = process.argv.slice(4);
      await runCommand(worktreeLaunchCommand, { argv, env: process.env, isTTY: Boolean(process.stdin.isTTY), stderr: process.stderr });
    });
  worktree
    .command('remove')
    .description(worktreeRemoveCommand.description)
    .helpOption(false)
    .allowUnknownOption()
    .allowExcessArguments(true)
    .action(async () => {
      const argv = process.argv.slice(4);
      await runCommand(worktreeRemoveCommand, { argv, env: process.env, isTTY: Boolean(process.stdin.isTTY), stderr: process.stderr });
    });

  const sideProject = program.command('side-project').description('Side-project (local-only repo) lifecycle operations');
  sideProject
    .command('init')
    .description(sideProjectInitCommand.description)
    .helpOption(false)
    .allowUnknownOption()
    .allowExcessArguments(true)
    .action(async () => {
      const argv = process.argv.slice(4);
      await runCommand(sideProjectInitCommand, { argv, env: process.env, isTTY: Boolean(process.stdin.isTTY), stderr: process.stderr });
    });

  const sourceControl = program.command('source-control').description('Source-control lifecycle operations');
  sourceControl
    .command('init')
    .description(sourceControlInitCommand.description)
    .helpOption(false)
    .allowUnknownOption()
    .allowExcessArguments(true)
    .action(async () => {
      const argv = process.argv.slice(4);
      await runCommand(sourceControlInitCommand, { argv, env: process.env, isTTY: Boolean(process.stdin.isTTY), stderr: process.stderr });
    });

  const execute = program.command('execute').description('Execution run-mode resolution and preparation');
  execute
    .command('resolve')
    .description(executeResolveCommand.description)
    .helpOption(false)
    .allowUnknownOption()
    .allowExcessArguments(true)
    .action(async () => {
      const argv = process.argv.slice(4);
      await runCommand(executeResolveCommand, { argv, env: process.env, isTTY: Boolean(process.stdin.isTTY), stderr: process.stderr });
    });
  execute
    .command('prepare')
    .description(executePrepareCommand.description)
    .helpOption(false)
    .allowUnknownOption()
    .allowExcessArguments(true)
    .action(async () => {
      const argv = process.argv.slice(4);
      await runCommand(executePrepareCommand, { argv, env: process.env, isTTY: Boolean(process.stdin.isTTY), stderr: process.stderr });
    });

  const plan = program.command('plan').description('Master Plan operations');
  plan
    .command('explode')
    .description(planExplodeCommand.description)
    .helpOption(false)
    .allowUnknownOption()
    .allowExcessArguments(true)
    .action(async () => {
      const argv = process.argv.slice(4);
      await runCommand(planExplodeCommand, { argv, env: process.env, isTTY: Boolean(process.stdin.isTTY), stderr: process.stderr });
    });
  plan
    .command('resolve')
    .description(planResolveCommand.description)
    .helpOption(false)
    .allowUnknownOption()
    .allowExcessArguments(true)
    .action(async () => {
      const argv = process.argv.slice(4);
      await runCommand(planResolveCommand, { argv, env: process.env, isTTY: Boolean(process.stdin.isTTY), stderr: process.stderr });
    });

  program
    .command('migrate')
    .description(migrateCommand.description)
    .helpOption(false)
    .allowUnknownOption()
    .allowExcessArguments(true)
    .action(async () => {
      const argv = process.argv.slice(3);
      await runCommand(migrateCommand, { argv, env: process.env, isTTY: Boolean(process.stdin.isTTY), stderr: process.stderr });
    });

  const skill = program.command('skill').description('Repository skill catalog operations');
  skill
    .command('list')
    .description(skillListCommand.description)
    .helpOption(false)
    .allowUnknownOption()
    .allowExcessArguments(true)
    .action(async () => {
      const argv = process.argv.slice(4);
      await runCommand(skillListCommand, { argv, env: process.env, isTTY: Boolean(process.stdin.isTTY), stderr: process.stderr });
    });

  const pipeline = program.command('pipeline').description('Pipeline event dispatch');
  pipeline
    .command('signal')
    .description(pipelineSignalCommand.description)
    .helpOption(false)
    .allowUnknownOption()
    .allowExcessArguments(true)
    .action(async () => {
      const argv = process.argv.slice(4);
      await runCommand(pipelineSignalCommand, { argv, env: process.env, isTTY: Boolean(process.stdin.isTTY), stderr: process.stderr });
    });

  // Gate subcommands lazy-load their modules so the pipeline-lib import chain
  // (incl. ajv) only fires when a gate command actually runs. Top-level eager
  // imports would force every cli invocation — even `--version` — to load the
  // pipeline runtime and its CJS deps.
  const gate = program.command('gate').description('pipeline gate operations');
  const gateApprove = gate.command('approve').description('approve a pipeline gate');
  gateApprove
    .command('plan')
    .description('Approve the project Master Plan')
    .allowUnknownOption()
    .allowExcessArguments(true)
    .action(async () => {
      const { approvePlanCommand } = await import('./commands/gate/approve-plan.js');
      const argv = process.argv.slice(5);
      await runCommand(approvePlanCommand, { argv, env: process.env, isTTY: Boolean(process.stdin.isTTY), stderr: process.stderr });
    });
  gateApprove
    .command('final')
    .description('Approve the project Final Review')
    .allowUnknownOption()
    .allowExcessArguments(true)
    .action(async () => {
      const { approveFinalCommand } = await import('./commands/gate/approve-final.js');
      const argv = process.argv.slice(5);
      await runCommand(approveFinalCommand, { argv, env: process.env, isTTY: Boolean(process.stdin.isTTY), stderr: process.stderr });
    });

  // Action-events `compose` lazy-loads so the pipeline-engine import chain
  // (parseActionEventFile, composer, etc.) only fires when this subcommand
  // actually runs. The catalog/shipped/custom UI surfaces are served in-process
  // by the dashboard's API routes and do not need CLI subcommands of their own.
  const actionEvents = program.command('action-events').description('Action/event catalog operations');
  actionEvents
    .command('compose')
    .description('Compose an action or orphan-event prompt (reads optional {overlay} from stdin)')
    .allowUnknownOption()
    .allowExcessArguments(true)
    .action(async () => {
      const { composeCommand } = await import('./commands/action-events/compose.js');
      const argv = process.argv.slice(4);
      await runCommand(composeCommand, { argv, env: process.env, isTTY: Boolean(process.stdin.isTTY), stderr: process.stderr });
    });

  const telemetry = program.command('telemetry').description('Harness telemetry capture operations');
  telemetry
    .command('capture')
    .description(telemetryCaptureCommand.description)
    .helpOption(false)
    .allowUnknownOption()
    .allowExcessArguments(true)
    .action(async () => {
      const argv = process.argv.slice(4);
      await runCommand(telemetryCaptureCommand, { argv, env: process.env, isTTY: Boolean(process.stdin.isTTY), stderr: process.stderr });
    });

  return program;
}
