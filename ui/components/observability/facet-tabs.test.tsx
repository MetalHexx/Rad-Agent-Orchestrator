import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FacetTabs } from './facet-tabs';
Object.assign(globalThis, { React });

const html = renderToStaticMarkup(createElement(FacetTabs, { active: 'files', onSelect: () => {} }));
assert.ok(['Overview', 'Transcript', 'Tools', 'Files', 'Raw'].every((t) => html.includes(t)), 'all five facets present (FR-6)');
assert.ok((html.match(/soon/gi) ?? []).length === 0, 'no facet is marked soon — Files is now live (FR-6)');
assert.ok(!/aria-disabled/.test(html), 'no facet exposes a disabled state any longer (FR-6, NFR-4)');
assert.ok(/aria-selected="true"/.test(html), 'the active Files tab is selectable and selected (FR-6)');
assert.ok(!/#[0-9a-fA-F]{6}/.test(html), 'no literal hex (NFR-4)');
console.log('✓ facet tabs: all five facets active, none soon');
