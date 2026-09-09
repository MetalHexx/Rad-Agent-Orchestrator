import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProjectKindBadge } from './project-kind-badge';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;

test('renders nothing for a standard project', () => {
  const html = renderToStaticMarkup(createElement(ProjectKindBadge, { projectType: 'standard' }));
  assert.equal(html, '', 'standard project should render no kind badge');
  assert.ok(!html.includes('Standard'), 'must not render a "Standard" label');
});

test('renders nothing when project_type is absent', () => {
  const html = renderToStaticMarkup(createElement(ProjectKindBadge, { projectType: undefined }));
  assert.equal(html, '', 'absent project_type defaults to standard and renders nothing');
});

test('renders "Side Project" for a side-project', () => {
  const html = renderToStaticMarkup(createElement(ProjectKindBadge, { projectType: 'side-project' }));
  assert.ok(html.includes('Side Project'), 'should render "Side Project" label');
});

test('side-project aria-label reflects project kind', () => {
  const html = renderToStaticMarkup(createElement(ProjectKindBadge, { projectType: 'side-project' }));
  assert.ok(html.includes('Project kind: Side Project'), 'aria-label must say "Project kind: Side Project"');
});

test('side-project badge does not emit an inline style attribute', () => {
  const html = renderToStaticMarkup(createElement(ProjectKindBadge, { projectType: 'side-project' }));
  assert.doesNotMatch(html, /style="/, 'must not carry an inline style attribute');
});

test('side-project badge carries the --kind-side-project token', () => {
  const html = renderToStaticMarkup(createElement(ProjectKindBadge, { projectType: 'side-project' }));
  assert.match(html, /--kind-side-project/);
});

test('renders "Portfolio" for a portfolio project', () => {
  const html = renderToStaticMarkup(createElement(ProjectKindBadge, { projectType: 'portfolio' }));
  assert.ok(html.includes('Portfolio'), 'should render "Portfolio" label');
});

test('portfolio aria-label reflects project kind', () => {
  const html = renderToStaticMarkup(createElement(ProjectKindBadge, { projectType: 'portfolio' }));
  assert.ok(html.includes('Project kind: Portfolio'), 'aria-label must say "Project kind: Portfolio"');
});

test('portfolio badge does not emit an inline style attribute', () => {
  const html = renderToStaticMarkup(createElement(ProjectKindBadge, { projectType: 'portfolio' }));
  assert.doesNotMatch(html, /style="/, 'must not carry an inline style attribute');
});

test('portfolio badge carries the --kind-portfolio token', () => {
  const html = renderToStaticMarkup(createElement(ProjectKindBadge, { projectType: 'portfolio' }));
  assert.match(html, /--kind-portfolio/);
});
