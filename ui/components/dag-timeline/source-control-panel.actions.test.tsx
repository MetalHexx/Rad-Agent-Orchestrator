import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SourceControlPanel } from './source-control-panel';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;

type PanelProps = React.ComponentProps<typeof SourceControlPanel>;

const withPr = {
  name: 'fake-api',
  branch: 'radorch/FAKE-NEWS',
  base_branch: 'main',
  remote_url: 'https://github.com/o/fake-api',
  compare_url: 'https://github.com/o/fake-api/compare/main...x',
  pr_url: 'https://github.com/o/fake-api/pull/42',
};
// Has a compare_url and no pr_url — exercises rule 4 (Compare outranks the auto-pr statuses).
const noPr = { ...withPr, pr_url: null };
// No compare_url either — exercises rules 5, 6, and 7 (the auto-pr status fallbacks).
const noPrNoCompare = { ...noPr, compare_url: null };
const bindByName = { 'fake-api': { state: 'bound' as const, path: '/clones/fake-api' } };

const render = (props: PanelProps) => renderToStaticMarkup(createElement(SourceControlPanel, props));
const standard = (repos: PanelProps['repos'], autoPr?: PanelProps['autoPr']) =>
  render({ repos, projectName: 'FAKE-NEWS', projectType: 'standard', autoPr, bindByName });

// A pull request links out — and withdraws Compare, which it supersedes
{
  const html = standard([withPr]);
  assert.ok(html.includes('href="https://github.com/o/fake-api/pull/42"'), 'pull-request link present');
  assert.ok(html.includes('PR #42'), 'pull-request number labelled');
  assert.ok(!html.includes(withPr.compare_url), 'Compare withdrawn once a pull request exists');
}

// A pull-request URL the number can't be parsed out of still labels the control
{
  const html = standard([{ ...withPr, pr_url: 'https://github.com/o/fake-api/pulls' }]);
  assert.ok(html.includes('>PR<'), 'unparsable pull-request URL falls back to a bare label');
}

// No pull request: Compare stands in for the eventual pull-request link
{
  const html = standard([noPr]);
  assert.ok(html.includes(`href="${noPr.compare_url}"`), 'Compare present while no pull request exists');
  assert.ok(html.includes('Compare'), 'Compare labelled');
}

// Mutual exclusivity: a repo with something to compare shows Compare alone, under every
// auto-pr policy — Compare outranks the auto-pr status message, it never joins it.
{
  const always = standard([noPr], 'always');
  assert.ok(always.includes('Compare'), 'Compare renders while there is something to compare');
  assert.ok(!always.includes('Opens automatically'), 'the auto-pr status does not join Compare');

  const ask = standard([noPr], 'ask');
  assert.ok(ask.includes('Compare'), 'Compare renders under auto-pr ask');
  assert.ok(!ask.includes('No PR yet'), 'the auto-pr status does not join Compare');

  const never = standard([noPr], 'never');
  assert.ok(never.includes('Compare'), 'Compare renders under auto-pr never');
  assert.ok(!never.includes('No PR'), 'the auto-pr status does not join Compare');

  const unset = standard([noPr]);
  assert.ok(unset.includes('Compare'), 'Compare renders under an unset auto-pr policy');
  assert.ok(!unset.includes('No PR'), 'the auto-pr status does not join Compare');
}

// The three non-interactive auto-pr statuses, once there is nothing left to compare
{
  const always = standard([noPrNoCompare], 'always');
  assert.ok(always.includes('Opens automatically'), 'auto-pr always announces the automatic open');
  assert.ok(!always.includes('/pull/'), 'no pull-request link while none exists');
  assert.ok(!always.includes('Compare'), 'no compare_url means no Compare control');
  assert.ok(always.includes('aria-disabled="true"'), 'the state cell is non-interactive but still announced');

  const ask = standard([noPrNoCompare], 'ask');
  assert.ok(ask.includes('No PR yet'), 'auto-pr ask reads as not-yet');
  assert.ok(ask.includes('aria-disabled="true"'), 'the state cell is non-interactive but still announced');

  const never = standard([noPrNoCompare], 'never');
  assert.ok(never.includes('No PR') && !never.includes('No PR yet'), 'auto-pr never reads as a flat no');
  assert.ok(never.includes('aria-disabled="true"'), 'the state cell is non-interactive but still announced');

  const unset = standard([noPrNoCompare]);
  assert.ok(unset.includes('No PR') && !unset.includes('No PR yet'), 'unset auto-pr matches never');
}

// Rule 2: an in-place repo keeps its carve-out status even with something to compare
{
  const inPlace = standard([{ ...noPr, in_place: true }], 'always');
  assert.ok(inPlace.includes('No PR (in-place)'), 'an in-place repo never opens a pull request');
  assert.ok(!inPlace.includes('Compare'), 'the in-place carve-out outranks Compare');
}

// An in-place repo with a real pull request shows the pull-request link, not the
// in-place carve-out status — pr_url always outranks the in-place status.
{
  const inPlaceWithPr = standard([{ ...withPr, in_place: true }]);
  assert.ok(inPlaceWithPr.includes('href="https://github.com/o/fake-api/pull/42"'), 'pull-request link present for an in-place repo');
  assert.ok(inPlaceWithPr.includes('PR #42'), 'pull-request number labelled');
  assert.ok(!inPlaceWithPr.includes('No PR (in-place)'), 'the in-place carve-out never hides a real pull request');
}

// A side-project has no pull-request affordance and no Compare
{
  const html = render({
    repos: [{ ...noPr, name: 'TOY' }], projectName: 'TOY', projectType: 'side-project', autoPr: 'always', bindByName: {},
  });
  assert.ok(!html.includes('No PR'), 'side-project renders no pull-request state');
  assert.ok(!html.includes('Opens automatically'), 'side-project ignores the auto-pr policy');
  assert.ok(!html.includes('Compare'), 'side-project renders no Compare');
  assert.ok(!html.includes('Pull Request'), 'the fourth column header is empty for an all-side-project panel');
}

// The folder control's visible label is the same full path it announces —
// no shortened stand-in, so truncation is purely a consequence of cell width
{
  const html = standard([withPr]);
  const marker = 'Open folder in file explorer: ';
  const at = html.indexOf(marker);
  assert.ok(at >= 0, 'folder control announces the folder it opens');
  const path = html.slice(at + marker.length, html.indexOf('"', at + marker.length));
  assert.ok(path.length > 0, 'folder path resolved');
  assert.ok(html.includes(`>${path}<`), 'the announced path is also the visible label');
}

console.log('SourceControlPanel actions ✓');
