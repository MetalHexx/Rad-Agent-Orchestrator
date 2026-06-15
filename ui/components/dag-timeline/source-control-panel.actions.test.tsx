import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SourceControlPanel } from './source-control-panel';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;

const withPr = { name: 'fake-api', branch: 'radorch/FAKE-NEWS', base_branch: 'main', remote_url: 'https://github.com/o/fake-api', compare_url: 'https://github.com/o/fake-api/compare/main...x', pr_url: 'https://github.com/o/fake-api/pull/42' };
const noPr = { ...withPr, pr_url: null };
const bindByName = { 'fake-api': { state: 'bound' as const, path: '/clones/fake-api' } };

// PR present → PR #42 link to the pr_url (FR-8)
{
  const html = renderToStaticMarkup(createElement(SourceControlPanel, { repos: [withPr], projectName: 'FAKE-NEWS', projectType: 'standard', bindByName }));
  assert.ok(html.includes('href="https://github.com/o/fake-api/pull/42"'), 'PR link href present');
  assert.ok(html.includes('PR #42'), 'PR number label present');
  // Compare present → compare link (FR-7)
  assert.ok(html.includes('href="https://github.com/o/fake-api/compare/main...x"'), 'compare link present');
  // Folder chip shows the truncated worktree path label, not the word "Folder" (FR-9, DD-6)
  assert.ok(html.includes('FAKE-NEWS/fake-api'), 'folder path label present');
}

// PR absent → muted, non-interactive "No PR" (FR-8, DD-4)
{
  const html = renderToStaticMarkup(createElement(SourceControlPanel, { repos: [noPr], projectName: 'FAKE-NEWS', projectType: 'standard', bindByName }));
  assert.ok(html.includes('No PR'), 'No PR indicator present');
  assert.ok(!html.includes('/pull/'), 'No PR has no pull link');
}

console.log('SourceControlPanel actions ✓');
