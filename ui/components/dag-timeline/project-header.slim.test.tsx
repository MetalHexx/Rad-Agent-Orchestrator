import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProjectHeader } from './project-header';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;

const sourceControl = {
  branch: 'radorch/FAKE-NEWS', base_branch: 'main', worktree_path: '/wt', auto_commit: 'always' as const, auto_pr: 'never' as const,
  remote_url: null, compare_url: 'https://github.com/o/r/compare/main...x', pr_url: null,
  repos: [{ name: 'fake-api', branch: 'radorch/FAKE-NEWS', base_branch: 'main', remote_url: null, compare_url: null, pr_url: null }],
};

const html = renderToStaticMarkup(createElement(ProjectHeader, {
  projectName: 'FAKE-NEWS', tier: 'execution', sourceControl, followMode: false, onToggleFollowMode: () => {},
// eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any));

assert.ok(html.includes('FAKE-NEWS'), 'project name still present');
// FR-4: header no longer surfaces source-control chrome
assert.ok(!html.includes('Auto-Commit'), 'auto-commit pill removed from header');
assert.ok(!html.includes('Auto-PR'), 'auto-pr pill removed from header');
assert.ok(!html.includes('Pull Request'), 'PR region removed from header');
assert.ok(!html.includes('radorch/FAKE-NEWS'), 'branch region removed from header');

// viewMode is absent above — no toggle should render (a project with no
// pipeline has nothing to switch to).
assert.ok(!html.includes('Overview'), 'no toggle text when viewMode is absent');
assert.ok(!html.includes('>Pipeline<'), 'no toggle text when viewMode is absent');

// Base UI's ToggleGroup renders through SSR (renderToStaticMarkup) the same
// as any other client component — a smoke check that it does not throw and
// that both toggle items are present once viewMode is supplied.
const htmlWithToggle = renderToStaticMarkup(createElement(ProjectHeader, {
  projectName: 'FAKE-NEWS', tier: 'execution', sourceControl, followMode: false, onToggleFollowMode: () => {},
  viewMode: 'pipeline', onViewModeChange: () => {},
// eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any));
assert.ok(htmlWithToggle.includes('Overview'), 'toggle renders an Overview option once viewMode is supplied');
assert.ok(htmlWithToggle.includes('Pipeline'), 'toggle renders a Pipeline option once viewMode is supplied');

// A portfolio root reaches this header with viewMode left undefined (it has
// no pipeline to switch between overview and pipeline views) — verify Follow
// Mode and the view toggle are genuinely absent rather than assumed, and
// that the portfolio's own kind badge still renders in their place.
const htmlPortfolio = renderToStaticMarkup(createElement(ProjectHeader, {
  projectName: 'PORTFOLIO-ROOT', followMode: false, onToggleFollowMode: () => {},
  projectType: 'portfolio',
// eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any));
assert.ok(!htmlPortfolio.includes('Follow Mode'), 'no Follow Mode switch for a portfolio header with no viewMode');
assert.ok(!htmlPortfolio.includes('Overview'), 'no view toggle for a portfolio header with no viewMode');
assert.ok(!htmlPortfolio.includes('>Pipeline<'), 'no view toggle for a portfolio header with no viewMode');
assert.ok(htmlPortfolio.includes('Project kind: Portfolio'), 'the portfolio kind badge renders');

console.log('ProjectHeader slim ✓');
