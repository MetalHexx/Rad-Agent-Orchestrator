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
} as any));

assert.ok(html.includes('FAKE-NEWS'), 'project name still present');
// FR-4: header no longer surfaces source-control chrome
assert.ok(!html.includes('Auto-Commit'), 'auto-commit pill removed from header');
assert.ok(!html.includes('Auto-PR'), 'auto-pr pill removed from header');
assert.ok(!html.includes('Pull Request'), 'PR region removed from header');
assert.ok(!html.includes('radorch/FAKE-NEWS'), 'branch region removed from header');

console.log('ProjectHeader slim ✓');
