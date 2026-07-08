import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FacetMultiselect } from './facet-multiselect';
Object.assign(globalThis, { React });

const options = [
  { value: 'Bash', count: 10 },
  { value: 'Read', count: 4 },
];

// The dropdown popup renders through a portal, which React's static-markup renderer
// does not serialize (confirmed: even with the underlying Menu defaultOpen, no popup
// content appears in the SSR string). So the always-mounted trigger is asserted via
// rendered markup, and the popover's internal wiring (options/select-all/clear-all)
// is asserted via source inspection, per the repo's readFileSync convention.
const render = (over: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(FacetMultiselect, { label: 'Tools', options, selected: 'all', onChange: () => {}, ...over } as never));

const source = fs.readFileSync(
  path.join(path.dirname(url.fileURLToPath(import.meta.url)), 'facet-multiselect.tsx'), 'utf8');

test('trigger renders the label and facetLabel(...) for all / a subset / none', () => {
  assert.ok(render().includes('Tools') && render().includes('All'), 'All label rendered for the "all" sentinel');
  assert.ok(render({ selected: new Set(['Bash']) }).includes('1 of 2'), 'N of M label rendered for a subset');
  assert.ok(render({ selected: new Set<string>() }).includes('None'), 'None label rendered for an empty selection');
});

test('trigger carries an active-border affordance only when filtered (not "all")', () => {
  assert.ok(!/border-\[color:var\(--chart-2\)\]/.test(render({ selected: 'all' })), 'no active border at "all"');
  assert.ok(/border-\[color:var\(--chart-2\)\]/.test(render({ selected: new Set(['Bash']) })), 'active border once filtered');
});

test('each option renders a Checkbox, a mono value label, and a right-aligned count (source wiring)', () => {
  assert.match(source, /<Checkbox[\s\S]{0,200}checked=\{isChecked\(opt\.value\)\}/, 'Checkbox bound to option checked state');
  assert.match(source, /font-mono[\s\S]{0,40}\{opt\.value\}/, 'mono value label');
  assert.match(source, /ml-auto[\s\S]{0,80}\{opt\.count\}/, 'right-aligned count');
});

test('Select all sets selection to the "all" sentinel; Clear all sets it to an empty Set (source wiring)', () => {
  assert.match(source, /onClick=\{\(\) => onChange\("all"\)\}/, 'Select all calls onChange("all")');
  assert.match(source, /onClick=\{\(\) => onChange\(new Set\(\)\)\}/, 'Clear all calls onChange(new Set())');
});

test('toggling the last unchecked option collapses the selection back to "all"; unchecking one keeps an explicit subset', () => {
  assert.match(source, /next\.size >= options\.length \? "all" : next/, 'a full subset normalizes to the "all" sentinel');
});
