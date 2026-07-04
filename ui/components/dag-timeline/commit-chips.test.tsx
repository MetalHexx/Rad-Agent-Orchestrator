import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CommitChips } from './commit-chips';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;

const compareUrlByRepo = { 'fake-api': 'https://github.com/o/fake-api/compare/main...x', 'fake-ui': 'https://github.com/o/fake-ui/compare/main...x' };

// Multi-repo, landed → one continuous link per repo: repo: hash (FR-11, DD-3)
{
  const html = renderToStaticMarkup(createElement(CommitChips, {
    repos: [{ name: 'fake-api', commit_hash: 'abc1234def' }, { name: 'fake-ui', commit_hash: '9f8e7d6c' }],
    compareUrlByRepo, singleRepo: false,
  }));
  assert.ok(html.includes('href="https://github.com/o/fake-api/commit/abc1234def"'), 'fake-api commit link');
  assert.ok(html.includes('fake-api:'), 'repo name + colon present');
  assert.ok(html.includes('abc1234'), 'short hash present');
  assert.ok(html.includes('fake-ui:'), 'second repo present');
  // NFR-6: shadcn Tooltip wrappers present — TooltipTrigger renders data-slot="tooltip-trigger" on the trigger element
  assert.ok(html.includes('data-slot="tooltip-trigger"'), 'TooltipTrigger renders data-slot attribute (NFR-6)');
  // Landed chip: no title= attribute (removed in favour of Tooltip) — aria-label still present
  assert.ok(!html.includes('title='), 'title= attribute removed from landed chip (NFR-6)');
  assert.ok(html.includes('aria-label="View fake-api commit abc1234 on GitHub"'), 'aria-label present on landed chip');
}

// Not landed → non-clickable icon + repo, never a bare hash (FR-11)
{
  const html = renderToStaticMarkup(createElement(CommitChips, {
    repos: [{ name: 'fake-api', commit_hash: null }], compareUrlByRepo, singleRepo: false,
  }));
  assert.ok(!html.includes('<a '), 'no anchor when not landed');
  assert.ok(html.includes('fake-api'), 'repo name present');
  // NFR-6: not-landed chip is also wrapped in a Tooltip trigger (data-slot="tooltip-trigger" on the span)
  assert.ok(html.includes('aria-label="fake-api — no commit yet"'), 'aria-label present on not-landed chip');
  assert.ok(html.includes('data-slot="tooltip-trigger"'), 'TooltipTrigger renders on not-landed chip (NFR-6)');
}

// Multi-repo + landed but not linkable (no base url) → short hash shown as plain
// text, NOT misreported as "no commit yet" (regression: a real commit must not vanish)
{
  const html = renderToStaticMarkup(createElement(CommitChips, {
    repos: [{ name: 'fake-api', commit_hash: 'abc1234def' }], compareUrlByRepo: { 'fake-api': null }, singleRepo: false,
  }));
  assert.ok(!html.includes('<a '), 'no anchor when not linkable');
  assert.ok(html.includes('abc1234'), 'short hash still shown for a landed-but-unlinkable commit');
  assert.ok(!html.includes('no commit yet'), 'a landed commit must NOT be reported as "no commit yet"');
  assert.ok(html.includes('aria-label="fake-api commit abc1234 (link unavailable)"'), 'aria-label reflects landed-but-unlinkable state');
}

// Single-repo collapse → just the hash, no repo name (FR-12)
{
  const html = renderToStaticMarkup(createElement(CommitChips, {
    repos: [{ name: 'fake-api', commit_hash: 'abc1234def' }], compareUrlByRepo, singleRepo: true,
  }));
  assert.ok(html.includes('abc1234'), 'hash present');
  assert.ok(!html.includes('fake-api:'), 'repo name dropped for single-repo');
}

// Single-repo + not linkable (no base url) → chip suppressed entirely (FR-12)
{
  const html = renderToStaticMarkup(createElement(CommitChips, {
    repos: [{ name: 'fake-api', commit_hash: 'abc1234def' }], compareUrlByRepo: { 'fake-api': null }, singleRepo: true,
  }));
  assert.ok(!html.includes('fake-api'), 'no repo name');
  assert.ok(!html.includes('abc1234'), 'no hash');
  assert.ok(!html.includes('<svg'), 'no icon — chip fully suppressed');
}

// The outer chip row wraps (flex-wrap) so a multi-repo cluster breaks onto its
// own lines once the controls row runs out of width, instead of overrunning the
// card edge (which the card's overflow-hidden would otherwise crop).
{
  const html = renderToStaticMarkup(createElement(CommitChips, {
    repos: [{ name: 'fake-api', commit_hash: 'abc1234def' }, { name: 'fake-ui', commit_hash: '9f8e7d6c' }],
    compareUrlByRepo, singleRepo: false,
  }));
  assert.match(html, /class="inline-flex flex-wrap items-center gap-3"/, 'outer chip row wraps instead of clipping');
}

// DD-7: full SHA + "View commit on GitHub" in tooltip (TooltipContent renders only if portal is SSR-available;
//        assert on aria-label which always renders as a proxy for the chip content contract)
{
  const html = renderToStaticMarkup(createElement(CommitChips, {
    repos: [{ name: 'fake-api', commit_hash: 'abc1234def5678901234' }],
    compareUrlByRepo: { 'fake-api': 'https://github.com/o/fake-api/compare/main...x' }, singleRepo: false,
  }));
  // Full SHA appears in the commit link href (not shortened)
  assert.ok(html.includes('href="https://github.com/o/fake-api/commit/abc1234def5678901234"'), 'full SHA in href (DD-7)');
  // TooltipTrigger renders on the chip (NFR-6)
  assert.ok(html.includes('data-slot="tooltip-trigger"'), 'TooltipTrigger renders on chip (NFR-6)');
}

// ── button variant (dag-widget card): each repo renders as an outline+icon button ──
// Scoped to the card via variant="button"; the timeline keeps the chip variant above.
{
  const html = renderToStaticMarkup(createElement(CommitChips, {
    repos: [{ name: 'fake-api', commit_hash: 'abc1234def' }, { name: 'fake-ui', commit_hash: '9f8e7d6c' }],
    compareUrlByRepo, singleRepo: false, variant: 'button', iconCssVar: '--tier-execution',
  }));
  assert.ok(html.includes('href="https://github.com/o/fake-api/commit/abc1234def"'), 'button-variant linkable chip is still a real commit link');
  assert.match(html, /class="[^"]*bg-background[^"]*"/, 'button-variant chip carries the outline house-button chrome (matches DocButton)');
  assert.match(html, /class="[^"]*\bh-7\b[^"]*"/, 'button-variant chip is the sm button height, aligning with sibling doc buttons');
  assert.ok(html.includes('fake-api: abc1234'), 'multi-repo button shows "name: hash"');
  assert.ok(html.includes('var(--tier-execution)'), 'git icon is tinted with the state tier var');
  assert.match(html, /class="inline-flex flex-wrap items-center gap-2"/, 'button cluster uses the controls-row gap-2, not the chip gap-3');
}

// button variant, single-repo → just the hash on the button (no repo name)
{
  const html = renderToStaticMarkup(createElement(CommitChips, {
    repos: [{ name: 'fake-api', commit_hash: 'abc1234def' }], compareUrlByRepo, singleRepo: true, variant: 'button',
  }));
  assert.match(html, /class="[^"]*bg-background[^"]*"/, 'single-repo button still uses outline chrome');
  assert.ok(html.includes('abc1234'), 'hash present');
  assert.ok(!html.includes('fake-api:'), 'no repo name for single-repo button');
}

// button variant, multi-repo not-linkable → non-interactive (disabled-look) button, still shows the landed hash
{
  const html = renderToStaticMarkup(createElement(CommitChips, {
    repos: [{ name: 'fake-api', commit_hash: 'abc1234def' }], compareUrlByRepo: { 'fake-api': null }, singleRepo: false, variant: 'button',
  }));
  assert.ok(!html.includes('<a '), 'not-linkable button is not an anchor');
  assert.match(html, /class="[^"]*opacity-60[^"]*"/, 'not-linkable button reads as disabled');
  assert.ok(html.includes('abc1234'), 'a landed-but-unlinkable commit still shows its hash, not "no commit yet"');
}

console.log('CommitChips ✓');
