import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProjectListItem } from './project-list-item';
import type { ProjectSummary } from '@/types/components';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;

function project(overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    name: 'my-project',
    tier: 'not_initialized',
    state: 'not_initialized',
    stateLabel: 'Not Initialized',
    hasState: false,
    hasMalformedState: false,
    ...overrides,
  };
}

function renderRow(p: ProjectSummary): string {
  return renderToStaticMarkup(
    createElement(ProjectListItem, { project: p, selected: false, onClick: () => {} }),
  );
}

test('a standard row shows the pipeline badge and no project-kind badge', () => {
  const html = renderRow(project({ state: 'planning', stateLabel: 'Planning', tier: 'planning' }));
  assert.ok(html.includes('Pipeline status: Planning'), 'must show the pipeline state badge');
  assert.ok(!html.includes('Project kind:'), 'must not show a project-kind badge');
});

test('a side-project row is unchanged — still only the pipeline badge', () => {
  const html = renderRow(
    project({ project_type: 'side-project', state: 'planning', stateLabel: 'Planning', tier: 'planning' }),
  );
  assert.ok(html.includes('Pipeline status: Planning'), 'side project rows keep the pipeline state badge');
  assert.ok(!html.includes('Project kind:'), 'side project must not gain a kind badge in the list');
});

test('a portfolio row shows the Portfolio badge and no pipeline status label', () => {
  const html = renderRow(project({ project_type: 'portfolio' }));
  assert.ok(html.includes('Project kind: Portfolio'), 'must show the Portfolio badge');
  assert.ok(!html.includes('Pipeline status:'), 'must not show the pipeline state badge');
});

test('a malformed portfolio row shows the warning badge and neither other badge', () => {
  const html = renderRow(project({ project_type: 'portfolio', hasMalformedState: true }));
  assert.ok(html.includes('Warning: Malformed state'), 'must show the warning badge');
  assert.ok(!html.includes('Project kind:'), 'must not show the Portfolio badge when malformed');
  assert.ok(!html.includes('Pipeline status:'), 'must not show the pipeline state badge when malformed');
});
