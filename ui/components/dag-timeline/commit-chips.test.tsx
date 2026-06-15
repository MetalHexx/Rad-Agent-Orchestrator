import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CommitChips } from './commit-chips';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;

const compareUrlByRepo = { 'fake-api': 'https://github.com/o/fake-api/compare/main...x', 'fake-ui': 'https://github.com/o/fake-ui/compare/main...x' };

// Multi-repo, landed → one continuous link per repo: repo: hash (FR-11, DD-3)
{
  const html = renderToStaticMarkup(createElement(CommitChips, {
    repos: [{ name: 'fake-api', commit_hash: 'abc1234def' }, { name: 'fake-ui', commit_hash: '9f8e7d6c' }],
    compareUrlByRepo, singleRepo: false,
  }));
  assert.ok(html.includes('href="https://github.com/o/fake-api/commit/abc1234def"'), 'fake-api commit link');
  assert.ok(html.includes('fake-api:'), 'repo name + colon present');
  assert.ok(html.includes('abc1234'), 'short hash present');
  assert.ok(html.includes('fake-ui:'), 'second repo present');
}

// Not landed → non-clickable icon + repo, never a bare hash (FR-11)
{
  const html = renderToStaticMarkup(createElement(CommitChips, {
    repos: [{ name: 'fake-api', commit_hash: null }], compareUrlByRepo, singleRepo: false,
  }));
  assert.ok(!html.includes('<a '), 'no anchor when not landed');
  assert.ok(html.includes('fake-api'), 'repo name present');
}

// Single-repo collapse → just the hash, no repo name (FR-12)
{
  const html = renderToStaticMarkup(createElement(CommitChips, {
    repos: [{ name: 'fake-api', commit_hash: 'abc1234def' }], compareUrlByRepo, singleRepo: true,
  }));
  assert.ok(html.includes('abc1234'), 'hash present');
  assert.ok(!html.includes('fake-api:'), 'repo name dropped for single-repo');
}

// Single-repo + not linkable (no base url) → chip suppressed entirely (FR-12)
{
  const html = renderToStaticMarkup(createElement(CommitChips, {
    repos: [{ name: 'fake-api', commit_hash: 'abc1234def' }], compareUrlByRepo: { 'fake-api': null }, singleRepo: true,
  }));
  assert.ok(!html.includes('fake-api'), 'no repo name');
  assert.ok(!html.includes('abc1234'), 'no hash');
  assert.ok(!html.includes('<svg'), 'no icon — chip fully suppressed');
}

console.log('CommitChips ✓');
