import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentNavigatorStrip, type AgentChip } from './agent-navigator-strip';
import { StickToBottomContext, type StickToBottomContextValue } from './stick-to-bottom-context';
Object.assign(globalThis, { React });

const agents: AgentChip[] = [
  { transcriptId: 'sess', label: 'main', role: 'main' },
  { transcriptId: 'a1', label: 'Coder 1', role: 'subagent' },
  { transcriptId: 'b1', label: 'Explore 1', role: 'subagent' },
];
const html = renderToStaticMarkup(createElement(AgentNavigatorStrip, { agents, activeId: 'a1', onSelect: () => {} }));
assert.ok(html.includes('main') && html.includes('Coder 1') && html.includes('Explore 1'), 'lists agent chips in order (FR-14, DD-5)');
assert.ok(/aria-current="true"/.test(html), 'active chip marks aria-current (FR-14, NFR-5)');
console.log('✓ agent strip: ordered chips + active');

// --- Jump-to-latest: engaged (pinned, the default context value with no provider) ---
{
  assert.ok(html.includes('aria-label="Jump to latest"'), 'docked Jump-to-latest button renders in the footer');
  const buttonMatch = /<button[^>]*aria-label="Jump to latest"[^>]*>/.exec(html);
  assert.ok(buttonMatch, 'Jump-to-latest button markup is present');
  // Match the real `disabled=""` DOM attribute, not the Tailwind `disabled:*`
  // variant class tokens that also appear in this button's class list.
  assert.ok(/\bdisabled=""/.test(buttonMatch![0]),
    'button is disabled while pinned (engaged), matching the default context state');
  assert.ok(!html.includes(' new</span>'), 'no "N new" hint is shown while pinned');
  console.log('✓ agent strip: Jump-to-latest disabled while pinned (default context)');
}

// --- Jump-to-latest: disengaged (custom context value — not pinned, events missed) ---
{
  const disengaged: StickToBottomContextValue = {
    pinned: false,
    newCount: 3,
    jumpToLatest: () => {},
    publish: () => {},
  };
  const disengagedHtml = renderToStaticMarkup(
    createElement(
      StickToBottomContext.Provider,
      { value: disengaged },
      createElement(AgentNavigatorStrip, { agents, activeId: 'a1', onSelect: () => {} }),
    ),
  );
  const buttonMatch = /<button[^>]*aria-label="Jump to latest"[^>]*>/.exec(disengagedHtml);
  assert.ok(buttonMatch, 'Jump-to-latest button markup is present when disengaged');
  assert.ok(!/\bdisabled=""/.test(buttonMatch![0]), 'button is enabled once disengaged');
  assert.ok(disengagedHtml.includes('3 new'), 'muted "N new" hint shows the unseen-event count when disengaged');
  console.log('✓ agent strip: Jump-to-latest enabled + "N new" hint when disengaged');
}
