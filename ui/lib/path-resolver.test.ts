import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { withHomedir } from './test-helpers.js';
import { getRegistryRoot, getProjectsRoot, toHomeRelativePath, collapseHomeInText } from './path-resolver.js';

test('getRegistryRoot returns the user-data root (parent of projects) (AD-6)', async () => {
  await withHomedir('C:\\fake\\home', () => {
    assert.equal(getRegistryRoot(), path.join('C:\\fake\\home', '.radorc'));
  });
});

test('getRegistryRoot is the parent of getProjectsRoot (AD-6)', async () => {
  await withHomedir('C:\\fake\\home', () => {
    assert.equal(getRegistryRoot(), path.dirname(getProjectsRoot()));
  });
});

test('toHomeRelativePath collapses a path under home to a ~-relative path', async () => {
  const home = 'C:\\fake\\home';
  await withHomedir(home, () => {
    const target = path.join(home, '.radorc', 'side-projects', 'RAINBOW-HELLO');
    assert.equal(toHomeRelativePath(target), path.join('~', '.radorc', 'side-projects', 'RAINBOW-HELLO'));
  });
});

test('toHomeRelativePath renders the home directory itself as ~', async () => {
  const home = 'C:\\fake\\home';
  await withHomedir(home, () => {
    assert.equal(toHomeRelativePath(home), '~');
  });
});

test('toHomeRelativePath returns a path outside home unchanged', async () => {
  const home = 'C:\\fake\\home';
  await withHomedir(home, () => {
    const outside = 'D:\\elsewhere\\project';
    assert.equal(toHomeRelativePath(outside), outside);
  });
});

test('collapseHomeInText collapses a home-directory occurrence embedded in prose', async () => {
  const home = 'C:\\fake\\home';
  await withHomedir(home, () => {
    const repoPath = path.join(home, '.radorc', 'worktrees', 'rad-orc-source');
    const text = `'rad-orc-source' is the user's registered clone at ${repoPath}; it is never removed`;
    assert.equal(
      collapseHomeInText(text),
      `'rad-orc-source' is the user's registered clone at ${path.join('~', '.radorc', 'worktrees', 'rad-orc-source')}; it is never removed`,
    );
  });
});
