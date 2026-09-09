import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { ProjectHeader } from './project-header';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;

function parse(html: string): Document {
  return new JSDOM(html).window.document;
}

// The control is opt-in: headers that don't wire onRequestDelete (none exist
// today, but the prop is optional) render no delete affordance at all.
{
  const html = renderToStaticMarkup(createElement(ProjectHeader, {
    projectName: 'NO-DELETE', followMode: false, onToggleFollowMode: () => {},
  }));
  const doc = parse(html);
  assert.equal(doc.querySelector('[aria-label^="Delete project"]'), null, 'no delete control when onRequestDelete is omitted');
}

// Control present, accessible name includes the project name, real <button>,
// and placed as a plain sibling of the badges inside the gap-3 row — before
// the ml-auto right-hand cluster (Follow Mode + view toggle), with no
// hand-tuned margin standing in for the row's own gap.
{
  const onRequestDelete = () => {};
  const html = renderToStaticMarkup(createElement(ProjectHeader, {
    projectName: 'DOOMED-PROJECT',
    state: 'executing', stateLabel: 'Executing',
    gateMode: 'task',
    followMode: false, onToggleFollowMode: () => {},
    onRequestDelete,
    viewMode: 'pipeline', onViewModeChange: () => {},
  }));
  const doc = parse(html);

  const button = doc.querySelector('[aria-label="Delete project DOOMED-PROJECT"]');
  assert.ok(button, 'delete control renders with an accessible name that includes the project name');
  assert.equal(button!.tagName, 'BUTTON', 'the control is a real <button>');

  const row = doc.querySelector('.flex.flex-wrap.items-center.gap-3');
  assert.ok(row, 'the header row carrying gap-3 exists');
  assert.ok(row!.contains(button), 'the delete control sits inside the gap-3 row');

  // Tooltip/TooltipTrigger render the button in place (no host wrapper), so
  // the button itself should already be a direct child of the row.
  assert.equal(button!.parentElement, row, 'the button is a plain child of the gap-3 row, not nested in an extra wrapper');

  // Exactly one ml-auto in the row — the right-hand cluster that now holds
  // both Follow Mode and the toggle, not two separate ml-auto siblings.
  const mlAutoMatches = row!.querySelectorAll('.ml-auto');
  assert.equal(mlAutoMatches.length, 1, 'exactly one ml-auto element in the header row');
  const rightCluster = mlAutoMatches[0];
  assert.ok(!rightCluster.contains(button), 'the delete control is not inside the ml-auto right-hand cluster');

  const rowChildren = Array.from(row!.children);
  assert.ok(
    rowChildren.indexOf(button as Element) < rowChildren.indexOf(rightCluster as Element),
    'the control renders before the right-hand cluster, after the badges',
  );
}

// Badge selection across the three project kinds, each rendered with a
// pipeline state supplied. A portfolio's kind badge replaces the state
// badge (it has no pipeline to report); a side project's own badge sits
// beside its state badge rather than replacing it; a standard project has
// no kind badge at all, so only the state badge shows.
{
  const render = (projectType?: 'standard' | 'side-project' | 'portfolio') => parse(renderToStaticMarkup(createElement(ProjectHeader, {
    projectName: 'BADGE-PROBE',
    state: 'executing', stateLabel: 'Executing',
    followMode: false, onToggleFollowMode: () => {},
    projectType,
  })));

  const standardDoc = render('standard');
  assert.ok(standardDoc.querySelector('[aria-label^="Pipeline status"]'), 'standard: state badge renders');
  assert.equal(standardDoc.querySelector('[aria-label^="Project kind"]'), null, 'standard: no kind badge renders');

  const sideProjectDoc = render('side-project');
  assert.ok(sideProjectDoc.querySelector('[aria-label^="Pipeline status"]'), 'side-project: state badge still renders');
  assert.ok(sideProjectDoc.querySelector('[aria-label^="Project kind"]'), 'side-project: its own kind badge renders alongside the state badge');

  const portfolioDoc = render('portfolio');
  assert.equal(portfolioDoc.querySelector('[aria-label^="Pipeline status"]'), null, 'portfolio: the kind badge replaces the state badge');
  assert.ok(portfolioDoc.querySelector('[aria-label^="Project kind"]'), 'portfolio: kind badge renders');
}

console.log('ProjectHeader delete control ✓');
