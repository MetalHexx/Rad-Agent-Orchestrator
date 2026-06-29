import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// The /rad-repo skill resolves a repo *by name* to its canonical main-clone path
// (via repo-registry.local.yml). Agents that operate inside a project worktree
// (coder/reviewer/source-control, …) must NOT consult it, or they can resolve to
// the main clone and write to the wrong working tree — see the MULTI-REPO-3 error
// log, Error 1. Only the planner keeps /rad-repo: as a spawned subagent it has no
// ambient registry awareness and still needs registry *identity* to author the
// repos: set. The deferred replacement is a worktree-aware spawn block.

const dir = path.join(process.cwd(), 'harness-files/agents');

// Planner KEEPS /rad-repo in its Skills section.
test('planner.md retains /rad-repo in its Skills section', () => {
  const text = fs.readFileSync(path.join(dir, 'planner.md'), 'utf8');
  assert.match(text, /## Skills[\s\S]*rad-repo/);
});

// Every other agent must be free of rad-repo across all of its harness files
// (.md prompt + .claude/.copilot-cli/.copilot-vscode .yml frontmatter) — a
// regression guard against the skill creeping back onto a worktree agent.
const deArmed = ['orchestrator', 'coder', 'coder-junior', 'coder-senior', 'reviewer', 'source-control'];

for (const name of deArmed) {
  const files = fs
    .readdirSync(dir)
    .filter((f) => f === `${name}.md` || (f.startsWith(`${name}.`) && f.endsWith('.yml')));
  assert.ok(files.length > 0, `expected to find harness files for agent "${name}"`);
  for (const file of files) {
    test(`${file} does NOT reference rad-repo`, () => {
      const text = fs.readFileSync(path.join(dir, file), 'utf8');
      assert.doesNotMatch(text, /rad-repo/);
    });
  }
}
