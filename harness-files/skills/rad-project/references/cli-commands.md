# CLI Command Reference

The `/rad-project` skill drives the `radorch` CLI. Every command emits one JSON envelope on stdout: `{ "ok": <bool>, "data": { ... }, "error": { ... } }`. Read result fields from inside `data`. Every command supports `--help` at the noun, subcommand, and flag level — prefer it over guessing flags.

## `project` operations

Classify the current working directory against the project registry:

```
node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" project locate
```

`project locate` takes no required arguments. It inspects the cwd and returns a JSON envelope whose `data` includes:

- `kind` — one of `worktree` | `main-clone` | `side-project` | `none`
- `worktree_name` — (when `kind` is `worktree`) the logical worktree name
- `repo` — (when `kind` is `worktree` or `main-clone`) the repository slug
- `projects` — (when a match is found) the project IDs whose registry entry covers this path
- `branch` — (when `kind` is `worktree`) the current branch

This command is distinct from the vestigial `radorch where` removed in PROJECT-GRAPH-2. `project locate` has a real cwd→project classification job and is a first-class consumer in the launch-flow: the agent calls it on start-up to determine which project context it has landed in before querying further.

List projects (optionally filtered by status or group):

```
node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" project list [--status <status>] [--group <group-id>]
```

Show one project's status, tier, worktrees, docs, and relationships:

```
node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" project show --id <project-id>
```

List a project's resolved worktrees (repo, path, branch, exists):

```
node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" project worktrees --id <project-id>
```

Preview what deleting a project would remove — a registered clone and other protected items are reported but untouched, and nothing is deleted:

```
node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" project delete --id <project-id> --preview
```

Delete a project and its workspaces:

```
node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" project delete --id <project-id>
```

A non-zero exit means at least one item could not be removed — check `data.items` for the ones that failed or were held back, fix the underlying issue, and re-run the same command to finish.

## `project-group` operations

List all project-groups:

```
node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" project-group list
```

Show one project-group's members and details:

```
node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" project-group show --group <group-id>
```

Create a project-group (`--description` is required — it is the scoping rationale):

```
node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" project-group create <name> --description "<what this group scopes and why>"
```

Edit a group's name or description (the description cannot be blanked):

```
node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" project-group edit <group-id> [--name <new-name>] [--description "<new rationale>"]
```

Add a project or sub-group to a group:

```
node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" project-group add <group-id> <member-id>
```

Remove a project or sub-group from a group:

```
node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" project-group remove <group-id> <member-id>
```

Delete a project-group (member projects stay registered — confirm with the user first):

```
node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" project-group delete <group-id>
```

## `graph` operations

Show the full work-graph (optionally scoped to a root node and traversal depth):

```
node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" graph show [--root <node-id>] [--depth <n>]
```

Add a relationship edge between two nodes:

```
node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" graph link <from-id> <to-id> --type <edge-type>
```

Remove a relationship edge:

```
node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" graph unlink <from-id> <to-id> --type <edge-type>
```

Remove dangling edges from the work-graph:

```
node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" graph prune
```
