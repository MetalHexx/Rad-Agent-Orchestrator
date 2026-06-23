import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FacetTabs } from './facet-tabs';
(globalThis as any).React = React;

const html = renderToStaticMarkup(createElement(FacetTabs, { active: 'raw', onSelect: () => {} }));
assert.ok(['Overview', 'Transcript', 'Tools', 'Files', 'Raw'].every((t) => html.includes(t)), 'all five facets present (FR-13)');
assert.ok((html.match(/soon/gi) ?? []).length === 4, 'the four future facets are marked soon (FR-13, DD-3)');
assert.ok(/aria-disabled/.test(html), 'future facets expose disabled state to AT (NFR-5)');
assert.ok(!/#[0-9a-fA-F]{6}/.test(html), 'no literal hex (NFR-4)');
console.log('✓ facet tabs: Raw active, four soon');
