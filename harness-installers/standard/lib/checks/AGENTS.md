# `harness-installers/standard/lib/checks/`

Pre-flight tooling probes, run by `index.js` before the wizard starts. They exist so a user learns
that `git` or `gh` is missing at install time rather than mid-pipeline weeks later — and they are
deliberately **advisory**, because neither tool is required to install.

## Conventions

- **`null | string`, never a throw.** `null` means healthy; a string is the message. Every probe is
  wrapped in `try`/`catch` — a throw would be caught by `index.js`'s outer handler and reported as a
  *failed install*, turning an advisory warning into an abort.
- **Every message names the tool and the recovery step**, and says which capability it unblocks —
  `git` for auto-commit, `gh` for auto-PR. A message that only reports absence gives the user nothing
  to do.
- **Pure with respect to state.** Probe, return, done. No config reads, no mutation, no caching.
- **No dependency on `lib/install/`.** These run before any install decision is made and must not
  acquire harness-specific knowledge.

## When a change here ripples

- **Added a probe for a tool the install or the pipeline depends on?** The equivalent post-install
  surface is `cli/`'s `doctor`, which is where a user goes when something is already broken. A tool
  probed here and not there is diagnosed once and never again; probed there and not here, and the
  user finds out mid-run. Add both. Detail: [`cli/AGENTS.md`](../../../../cli/AGENTS.md)

- **Changed a message, or the capability a message names?** These strings name
  `orchestration.yml` settings by field — `auto_commit`, `auto_pr` — and nothing resolves them. A
  field renamed in the shipped config leaves the installer telling users to configure something that
  no longer exists. Detail: [`runtime-config/AGENTS.md`](../../../../runtime-config/AGENTS.md)

- **Made a probe blocking, or gave it a non-`null`/`string` return?** `index.js` treats any returned
  value as a warning to print and does not branch on it, so a new shape is silently ignored, while a
  throw aborts the whole install with an "Installation failed" message. Change the caller in the same
  edit. Detail: [`../../AGENTS.md`](../../AGENTS.md)

## Commands

```
node --test harness-installers/standard/tests/lib/checks-tooling.test.mjs
```

## Further reading

- [`../../AGENTS.md`](../../AGENTS.md) — the package these probes run inside
- [`../install/AGENTS.md`](../install/AGENTS.md) — what runs after the wizard
- [`cli/AGENTS.md`](../../../../cli/AGENTS.md) — `doctor`, the post-install equivalent
