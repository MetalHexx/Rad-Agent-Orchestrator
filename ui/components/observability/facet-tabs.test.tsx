import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FacetTabs } from './facet-tabs';
Object.assign(globalThis, { React });

const html = renderToStaticMarkup(createElement(FacetTabs, { active: 'raw', onSelect: () => {} }));
assert.ok(['Overview', 'Transcript', 'Tools', 'Files', 'Raw'].every((t) => html.includes(t)), 'all five facets present (FR-13)');
assert.ok((html.match(/soon/gi) ?? []).length === 3, 'the three remaining future facets are marked soon (FR-1, NFR-4)');
assert.ok(/aria-disabled/.test(html), 'future facets expose disabled state to AT (NFR-5)');
assert.ok(!/#[0-9a-fA-F]{6}/.test(html), 'no literal hex (NFR-4)');
console.log('✓ facet tabs: Overview + Raw active, three soon');
