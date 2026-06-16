import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SourceControlPanel } from './source-control-panel';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;

const repo = { name: 'fake-api', branch: 'radorch/FAKE-NEWS', base_branch: 'main', remote_url: 'https://github.com/o/fake-api', compare_url: 'https://github.com/o/fake-api/compare/main...x', pr_url: null };
const bindByName = { 'fake-api': { state: 'bound' as const, path: '/clones/fake-api' } };

// section label + repo identity + branch + registry deep link (FR-1, FR-6, DD-1)
{
  const html = renderToStaticMarkup(createElement(SourceControlPanel, {
    repos: [repo], projectName: 'FAKE-NEWS', projectType: 'standard', autoCommit: 'always', autoPr: 'never', bindByName,
  }));
  assert.ok(html.includes('Source Control'), 'section label present');
  assert.ok(html.includes('fake-api'), 'repo name present');
  assert.ok(html.includes('radorch/FAKE-NEWS'), 'branch present');
  assert.ok(html.includes('main'), 'base branch present');
  assert.ok(html.includes('href="/repo-registry?repo=fake-api"'), 'registry deep link present (FR-6)');
  assert.ok(html.includes('Worktree'), 'location-kind badge present (FR-10)');
  // SC-PANEL-POLISH: badges show a locked Yes/No, not the raw policy word
  assert.ok(html.includes('auto-commit: Yes'), 'auto-commit shows locked Yes (always)');
  assert.ok(html.includes('auto-pr: No'), 'auto-pr shows locked No (never)');
}

// SC-PANEL-POLISH: `ask`/unset policies render no badge at all
{
  const html = renderToStaticMarkup(createElement(SourceControlPanel, {
    repos: [repo], projectName: 'FAKE-NEWS', projectType: 'standard', autoCommit: 'ask', bindByName,
  }));
  assert.ok(!html.includes('auto-commit:'), 'ask auto-commit renders no badge');
  assert.ok(!html.includes('auto-pr:'), 'undefined auto-pr renders no badge');
}

// side-project: no registry link (FR-10)
{
  const html = renderToStaticMarkup(createElement(SourceControlPanel, {
    repos: [{ ...repo, name: 'TOY' }], projectName: 'TOY', projectType: 'side-project', bindByName: {},
  }));
  assert.ok(!html.includes('/repo-registry?repo='), 'side-project renders no registry link');
}

// FR-10: side-project branch arrow suppressed — branch alone, no → base_branch
{
  const html = renderToStaticMarkup(createElement(SourceControlPanel, {
    repos: [{ ...repo, name: 'TOY', branch: 'feature/xyz', base_branch: 'main' }],
    projectName: 'TOY', projectType: 'side-project', bindByName: {},
  }));
  assert.ok(!html.includes('→'), 'side-project must NOT render → arrow');
  assert.ok(html.includes('feature/xyz'), 'side-project branch name still present');
}

// FR-10: non-side-project renders branch → base_branch arrow
{
  const html = renderToStaticMarkup(createElement(SourceControlPanel, {
    repos: [repo], projectName: 'FAKE-NEWS', projectType: 'standard', bindByName,
  }));
  assert.ok(html.includes('→'), 'non-side-project must render → arrow');
  assert.ok(html.includes('main'), 'base branch present after arrow');
}

console.log('SourceControlPanel rows ✓');
