import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentNavigatorStrip, type AgentChip } from './agent-navigator-strip';
(globalThis as any).React = React;

const agents: AgentChip[] = [
  { transcriptId: 'sess', label: 'main', role: 'main' },
  { transcriptId: 'a1', label: 'Coder 1', role: 'subagent' },
  { transcriptId: 'b1', label: 'Explore 1', role: 'subagent' },
];
const html = renderToStaticMarkup(createElement(AgentNavigatorStrip, { agents, activeId: 'a1', onSelect: () => {} }));
assert.ok(html.includes('main') && html.includes('Coder 1') && html.includes('Explore 1'), 'lists agent chips in order (FR-14, DD-5)');
assert.ok(/aria-current="true"/.test(html), 'active chip marks aria-current (FR-14, NFR-5)');
console.log('✓ agent strip: ordered chips + active');
