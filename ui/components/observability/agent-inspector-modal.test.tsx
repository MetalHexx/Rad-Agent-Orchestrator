import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentInspectorModal } from './agent-inspector-modal';
Object.assign(globalThis, { React });

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, 'agent-inspector-modal.tsx'), 'utf-8');

const noop = () => {};

// --- SSR: title shows the table-mapped label, not the raw session id (items 2 & 4) ---
// Effects (fetch/SSE) don't run under static rendering, so navList is empty and the
// title resolves from the labels map alone — exactly the "Main Agent" guarantee.
{
  const html = renderToStaticMarkup(createElement(AgentInspectorModal, {
    sessionId: 'sess-1',
    agentId: 'sess-1',
    labels: new Map([['sess-1', 'Main Agent']]),
    onSelectAgent: noop,
    onClose: noop,
    isFullScreen: false,
    onToggleFullScreen: noop,
  }));
  assert.ok(html.includes('Main Agent'), 'title renders the mapped Main Agent label (item 4)');
  assert.ok(!html.includes('sess-1'), 'title never falls back to the raw session id (item 4)');
  assert.ok(html.includes('aria-label="Previous agent"'), 'content-edge Previous agent button present (item 5)');
  assert.ok(html.includes('aria-label="Next agent"'), 'content-edge Next agent button present (item 5)');
  console.log('✓ agent inspector modal: Main Agent title + content-edge chevrons');
}

// --- Source: one-line title (no stacked flex-col), mapped chips, retired header nav ---
{
  assert.ok(!source.includes('flex min-w-0 flex-col gap-0.5'), 'title drops the stacked flex-col layout for an inline one-liner (item 3)');
  assert.ok(!source.includes('AgentPrevNext'), 'header prev/next pair removed in favor of content-edge chevrons (item 5)');
  assert.ok(source.includes('labels?.get(a.transcriptId) ?? a.label'), 'strip chips use the table-mapped labels (item 2)');
  assert.ok(source.includes("labels?.get(agentId ?? '')"), 'title uses the table-mapped label (items 2 & 4)');
  assert.ok(source.includes('import { FilesFacet }'), 'Files facet imported into the inspector (FR-6)');
  assert.ok(source.includes("activeFacet === 'files'"), 'modal dispatches the Files facet branch (FR-6, AD-5)');
  console.log('✓ agent inspector modal: one-line title, mapped chips, retired header nav');
}

// --- Source: TranscriptFacet is keyed by agentId (phase review Finding 1) ---
// Without this key, switching agents while the Transcript facet is active reconciles
// TranscriptTimeline in place instead of remounting it, so useStickToBottom's
// pinned/newCount (and the raw scroll position) leak from the previously-viewed
// agent's transcript into the newly-selected one.
{
  assert.ok(
    source.includes('<TranscriptFacet key={agentId} transcript={transcript} />'),
    'Transcript facet is keyed by agentId so the scroller remounts fresh on every agent switch (phase review Finding 1)',
  );
  console.log('✓ agent inspector modal: Transcript facet keyed by agentId');
}
