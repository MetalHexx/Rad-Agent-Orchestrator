import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FacetTabs } from './facet-tabs';
Object.assign(globalThis, { React });

const html = renderToStaticMarkup(createElement(FacetTabs, { active: 'raw', onSelect: () => {} }));
assert.ok(['Overview', 'Transcript', 'Tools', 'Files', 'Raw'].every((t) => html.includes(t)), 'all five facets present (FR-13)');
assert.ok((html.match(/soon/gi) ?? []).length === 2, 'the two remaining future facets (Tools, Files) are marked soon (FR-1)');
assert.ok(/aria-disabled/.test(html), 'future facets expose disabled state to AT (NFR-4)');
assert.ok(!/#[0-9a-fA-F]{6}/.test(html), 'no literal hex (NFR-3)');
console.log('✓ facet tabs: Overview + Transcript + Raw active, two soon');
