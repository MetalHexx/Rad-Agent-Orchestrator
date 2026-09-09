import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SourceControlPanel, buildFolderOpenError } from './source-control-panel';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;

type PanelProps = React.ComponentProps<typeof SourceControlPanel>;

const repo = {
  name: 'fake-api',
  branch: 'radorch/FAKE-NEWS',
  base_branch: 'main',
  remote_url: 'https://github.com/o/fake-api',
  compare_url: 'https://github.com/o/fake-api/compare/main...x',
  pr_url: null,
};
const bindByName = { 'fake-api': { state: 'bound' as const, path: '/clones/fake-api' } };

const render = (props: PanelProps) => renderToStaticMarkup(createElement(SourceControlPanel, props));

/** One string per repo row, starting at that row's `data-location-kind` value. */
const rowSegments = (html: string) => html.split('data-location-kind=').slice(1);

// Repo identity: section label, name, branch, and the registry deep link
{
  const html = render({ repos: [repo], projectName: 'FAKE-NEWS', projectType: 'standard', bindByName });
  assert.ok(html.includes('Source Control'), 'section label present');
  assert.ok(html.includes('fake-api'), 'repo name present');
  assert.ok(html.includes('radorch/FAKE-NEWS'), 'branch present');
  assert.ok(html.includes('href="/repo-registry?repo=fake-api"'), 'registry deep link present');
}

// The retired panel-level policy badges are gone
{
  const html = render({
    repos: [repo], projectName: 'FAKE-NEWS', projectType: 'standard',
    autoCommit: 'always', autoPr: 'never', bindByName,
  });
  assert.ok(!html.includes('auto-commit'), 'no auto-commit badge');
  assert.ok(!html.includes('auto-pr'), 'no auto-pr badge');
}

// A worktree is the norm — it earns no location chip, and the column is named for it
{
  const html = render({ repos: [repo], projectName: 'FAKE-NEWS', projectType: 'standard', bindByName });
  assert.ok(html.includes('data-location-kind="worktree"'), 'row reports its worktree kind');
  assert.ok(!html.includes('In-place'), 'worktree row renders no location chip');
  assert.ok(!html.includes('Side-project'), 'worktree row renders no location chip');
  assert.ok(html.includes('Worktree'), 'third column is named Worktree while every row is one');

  const iRepo = html.indexOf('>Repo<');
  const iBranch = html.indexOf('>Branch<');
  const iWorktree = html.indexOf('>Worktree<');
  const iPr = html.indexOf('>Pull Request<');
  assert.ok(
    iRepo >= 0 && iRepo < iBranch && iBranch < iWorktree && iWorktree < iPr,
    'header columns read Repo, Branch, Worktree, Pull Request left to right'
  );
}

// An in-place repo earns a chip, and the column falls back to the generic name
{
  const html = render({
    repos: [{ ...repo, in_place: true }], projectName: 'FAKE-NEWS', projectType: 'standard', bindByName,
  });
  assert.ok(html.includes('data-location-kind="in-place"'), 'row reports its in-place kind');
  assert.ok(html.includes('In-place'), 'in-place row renders a location chip');
  assert.ok(html.includes('Location'), 'third column falls back to Location');
  assert.ok(!html.includes('>Worktree<'), 'third column is no longer named Worktree');

  const iRepo = html.indexOf('>Repo<');
  const iBranch = html.indexOf('>Branch<');
  const iLocation = html.indexOf('>Location<');
  const iPr = html.indexOf('>Pull Request<');
  assert.ok(
    iRepo >= 0 && iRepo < iBranch && iBranch < iLocation && iLocation < iPr,
    'header columns read Repo, Branch, Location, Pull Request left to right'
  );
}

// A side-project earns a chip too, and drops the dot / registry link / base branch
{
  const html = render({
    repos: [{ ...repo, name: 'TOY', branch: 'feature/xyz' }],
    projectName: 'TOY', projectType: 'side-project', bindByName: {},
  });
  assert.ok(html.includes('data-location-kind="side-project"'), 'row reports its side-project kind');
  assert.ok(html.includes('Side-project'), 'side-project row renders a location chip');
  assert.ok(!html.includes('/repo-registry?repo='), 'side-project renders no registry link');
  assert.ok(!html.includes('→'), 'side-project suppresses the base-branch arrow');
  assert.ok(html.includes('feature/xyz'), 'side-project branch name still present');
}

// The defect this rebuild fixes: a mixed panel resolves the kind per row, not once for the panel
{
  const html = render({
    repos: [
      { ...repo, name: 'fake-api', in_place: true },
      { ...repo, name: 'fake-ui', pr_url: 'https://github.com/o/fake-ui/pull/5' },
    ],
    projectName: 'FAKE-NEWS',
    projectType: 'standard',
    bindByName: { 'fake-api': { state: 'bound', path: '/clones/fake-api' }, 'fake-ui': { state: 'bound', path: null } },
  });
  const rows = rowSegments(html);
  assert.equal(rows.length, 2, 'both repos render a row');
  assert.ok(rows[0].startsWith('"in-place"'), 'first row is in-place');
  assert.ok(rows[1].startsWith('"worktree"'), 'second row is a worktree');
  assert.ok(rows[0].includes('In-place'), 'the in-place row carries the chip');
  assert.ok(!rows[1].includes('In-place'), 'the worktree row carries no chip');
  assert.ok(rows[1].includes('/pull/5'), 'the worktree row keeps its own pull request');
}

// Non-side-project renders branch → base_branch
{
  const html = render({ repos: [repo], projectName: 'FAKE-NEWS', projectType: 'standard', bindByName });
  assert.ok(html.includes('→'), 'non-side-project renders the base-branch arrow');
  assert.ok(html.includes('main'), 'base branch present after the arrow');
}

// Empty panel gate
{
  assert.equal(render({ repos: [], projectName: 'FAKE-NEWS', bindByName: {} }), '', 'no repos renders nothing');
}

// A failed file-explorer open surfaces an actionable message naming the folder
{
  const msg = buildFolderOpenError('~/.radorc/worktrees/FAKE-NEWS/fake-api/');
  assert.ok(/navigate to it directly/i.test(msg), 'message tells the user to navigate manually');
  assert.ok(msg.includes('~/.radorc/worktrees/FAKE-NEWS/fake-api/'), 'message includes the folder path');
}

console.log('SourceControlPanel rows ✓');
