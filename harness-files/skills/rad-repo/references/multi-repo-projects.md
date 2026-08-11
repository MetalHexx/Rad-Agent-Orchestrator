# Multi-Repo Projects

## What makes a project multi-repo

Most of your work lives in a single repository. But sometimes — when a feature touches a backend service, a frontend, a shared library, and deployment scripts — the work spans multiple repositories. When several repos are part of the same unit of work, they form a **multi-repo project**.

The key is that they change together. A feature is not finished when code lands in one repo; it is finished when all the related changes are in place across all the repos that needed them. Treating them as a unit, rather than a series of separate tasks, is how you ship a complete feature.

## How the workspace is arranged

A multi-repo project lives in a single folder on your machine — the **project workspace**. Inside it, each repository the project touches is checked out into its own subfolder.

```
my-project-workspace/
  backend-api/
  web-frontend/
  shared-client-lib/
  infra-config/
```

This layout serves a purpose: every repository the project needs is right there, under one parent folder, so they can be worked on together.

## Where the agent stands

When you launch a multi-repo project, the agent stands in the workspace folder — above all the repos, not inside one of them. That position gives the agent sight lines to every repo the project touches.

This is why launching a project opens a new terminal. The agent needs to be in the workspace folder to see all the repos at once and orchestrate changes across them. If you started in a single clone (one repo), the agent would have no way to know the other repos existed or where they live. The workspace folder is the only place where the full picture is visible.

## Why each task carries its repo

A project's tasks are organized by which repositories they affect. When you pick up a task, it names the repo or repos involved. The agent reads that information and works in the right place, so your changes land in the right repository and your commits go to the right repo as well.

This is how multi-repo coordination works: the task declares intent (which repos matter), and the agent stands in the workspace where it can reach all of them, directed by that declaration.

## Why a single clone is not enough

You might think: "I have the backend repo cloned already. Can I just add the frontend to my clone somehow?"

The answer is no, because a clone is a boundary. A single git repository has its own working directory, its own branch state, and its own commits. The other repos in the project are outside that boundary — they exist on your filesystem somewhere else, they have different branches, and their commits are separate.

The workspace model solves this by putting all the repos on equal footing: they are all folders under the project workspace, each with its own identity, branches, and history. The agent can see them all and work with them all without the boundary problems a nested approach would create.

If you have already cloned a repo elsewhere — a personal clone or a shared team location — you can register that location so rad-orc knows where to reach it. For a multi-repo project, that registered clone is where each repo's own folder under the workspace is cut from and pushed to — you still get the layout described above, one fresh folder per repo, side by side under the project workspace. Binding directly to a branch you already have checked out, so the project runs inside that existing clone with no new folder at all, is only available to a single-repo project.
