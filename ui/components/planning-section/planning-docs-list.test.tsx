import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PlanningDocsList, showsDraftBadge } from './planning-docs-list';
import type { Artifact } from '@/lib/artifact-model';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const requirements: Artifact = {
  fileName: 'DEMO-REQUIREMENTS.md', kind: 'markdown', label: 'Requirements', title: null,
  isMarkdown: true, pinned: true, category: 'requirements',
};
const masterPlan: Artifact = {
  fileName: 'DEMO-MASTER-PLAN.md', kind: 'markdown', label: 'Master Plan', title: null,
  isMarkdown: true, pinned: true, category: 'master-plan',
};
const otherDoc: Artifact = {
  fileName: 'DEMO-NOTES.md', kind: 'markdown', label: 'Doc', title: 'Notes', isMarkdown: true,
};
const artifacts: Artifact[] = [requirements, masterPlan, otherDoc];
const noop = () => {};

function render(props: Parameters<typeof PlanningDocsList>[0]): string {
  return renderToStaticMarkup(createElement(PlanningDocsList, props));
}

// ─── Pure helper — showsDraftBadge ─────────────────────────────────────────

test('showsDraftBadge: true only for the Requirements row when status is "draft"', () => {
  assert.equal(showsDraftBadge(requirements, 'draft'), true);
});

test('showsDraftBadge: false for the Requirements row when status is "approved"', () => {
  assert.equal(showsDraftBadge(requirements, 'approved'), false);
});

test('showsDraftBadge: false for the Requirements row when status is an unrecognized value', () => {
  assert.equal(showsDraftBadge(requirements, 'something-else'), false);
});

test('showsDraftBadge: false for the Requirements row when status is null', () => {
  assert.equal(showsDraftBadge(requirements, null), false);
});

test('showsDraftBadge: false for a non-Requirements row even when status is "draft"', () => {
  assert.equal(showsDraftBadge(masterPlan, 'draft'), false);
  assert.equal(showsDraftBadge(otherDoc, 'draft'), false);
});

// ─── Render — Draft badge ───────────────────────────────────────────────────

test('renders the Draft badge on the Requirements row when requirementsStatus is "draft"', () => {
  const html = render({ artifacts, requirementsStatus: 'draft', onOpen: noop, onDelete: noop });
  assert.ok(/>Draft</.test(html), 'visible "Draft" pill text rendered');
  assert.ok(html.includes('var(--tier-planning)'), 'Draft pill uses the planning tier token');
});

test('omits the Draft badge when requirementsStatus is "approved"', () => {
  const html = render({ artifacts, requirementsStatus: 'approved', onOpen: noop, onDelete: noop });
  assert.ok(!/>Draft</.test(html), 'no Draft pill when approved');
});

test('omits the Draft badge for any other requirementsStatus value', () => {
  const html = render({ artifacts, requirementsStatus: 'in_review', onOpen: noop, onDelete: noop });
  assert.ok(!/>Draft</.test(html), 'no Draft pill for an unrecognized status');
});

test('omits the Draft badge when requirementsStatus is null', () => {
  const html = render({ artifacts, requirementsStatus: null, onOpen: noop, onDelete: noop });
  assert.ok(!/>Draft</.test(html), 'no Draft pill when null');
});

// ─── Render — row content & ordering ───────────────────────────────────────

test('renders one row per artifact, in the given order, with no re-sorting', () => {
  const html = render({ artifacts, requirementsStatus: null, onOpen: noop, onDelete: noop });
  // Rows no longer render the filename anywhere (the duplicated label span that
  // carried it is gone), so ordering is verified against each row's visible
  // title text instead — still unique per row and still position-stable.
  const reqIdx = html.indexOf('Requirements');
  const mpIdx = html.indexOf('Master Plan');
  const notesIdx = html.indexOf('Notes');
  assert.ok(reqIdx !== -1 && mpIdx !== -1 && notesIdx !== -1, 'all three rows rendered');
  assert.ok(reqIdx < mpIdx && mpIdx < notesIdx, 'rows preserve incoming array order (Requirements, Master Plan, then the rest)');
});

test('renders nothing when there are no artifacts', () => {
  const html = render({ artifacts: [], requirementsStatus: null, onOpen: noop, onDelete: noop });
  assert.equal(html, '');
});

test('open and delete controls are real sibling <button>s, not a nested role="button"', () => {
  const html = render({ artifacts, requirementsStatus: null, onOpen: noop, onDelete: noop });
  const deleteButtons = (html.match(/<button[^>]*aria-label="Delete artifact"/g) ?? []).length;
  assert.equal(deleteButtons, 3, 'one delete control per row');
  assert.ok(!html.includes('role="button"'), 'no synthetic role="button" controls');
});

test('no duplicated label renders next to the delete button', () => {
  const html = render({ artifacts, requirementsStatus: null, onOpen: noop, onDelete: noop });
  // Match visible text nodes only (the exact `>text<` tag-boundary fragment) —
  // a raw substring count would also catch the open button's aria-label and
  // the icon badge's own aria-label (set via SpinnerBadge's `label` prop even
  // when `hideLabel` suppresses its visible span), which never lands on "1"
  // even after the fix.
  const visibleMasterPlanTextNodes = (html.match(/>Master Plan</g) ?? []).length;
  assert.equal(visibleMasterPlanTextNodes, 1, 'Master Plan renders as a visible text node exactly once — no duplicated label sits next to the delete button');
});

test('the open control uses the full-row overlay technique (absolute inset-0)', () => {
  const html = render({ artifacts, requirementsStatus: null, onOpen: noop, onDelete: noop });
  const openButtonMatch = html.match(/<button[^>]*aria-label="Master Plan"[^>]*><\/button>/);
  assert.ok(openButtonMatch, 'the Master Plan open button renders as a self-closing full-row overlay');
  assert.match(openButtonMatch![0], /class="[^"]*\babsolute inset-0\b[^"]*"/, 'open button stretches over the whole row via absolute inset-0');
});

// ─── Interaction — callbacks fire with the correct index/artifact ─────────

test('clicking a row open control invokes onOpen with that row\'s index', async () => {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><div id="root"></div>');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).window = dom.window;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).document = dom.window.document;

  const { createRoot } = await import('react-dom/client');
  const { act } = await import('react');

  const opened: number[] = [];
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(PlanningDocsList, {
      artifacts, requirementsStatus: null, onOpen: (i) => opened.push(i), onDelete: noop,
    }));
  });

  const buttons = container.querySelectorAll('button[aria-label^="Master Plan"]');
  assert.equal(buttons.length, 1, 'the Master Plan open control is present');
  await act(async () => {
    (buttons[0] as HTMLButtonElement).click();
  });

  assert.deepStrictEqual(opened, [1], 'onOpen fired once with the Master Plan row\'s index (1)');

  await act(async () => { root.unmount(); });
});

test('clicking a row delete control invokes onDelete with that row\'s artifact', async () => {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><div id="root"></div>');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).window = dom.window;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).document = dom.window.document;

  const { createRoot } = await import('react-dom/client');
  const { act } = await import('react');

  const deleted: Artifact[] = [];
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(PlanningDocsList, {
      artifacts, requirementsStatus: null, onOpen: noop, onDelete: (a) => deleted.push(a),
    }));
  });

  const buttons = container.querySelectorAll('button[aria-label="Delete artifact"]');
  assert.equal(buttons.length, 3, 'one delete control per row');
  await act(async () => {
    (buttons[2] as HTMLButtonElement).click();
  });

  assert.deepStrictEqual(deleted, [otherDoc], 'onDelete fired once with the third row\'s artifact');

  await act(async () => { root.unmount(); });
});

test('clicking the delete button does not also invoke onOpen', async () => {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><div id="root"></div>');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).window = dom.window;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).document = dom.window.document;

  const { createRoot } = await import('react-dom/client');
  const { act } = await import('react');

  const opened: number[] = [];
  const deleted: Artifact[] = [];
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(PlanningDocsList, {
      artifacts, requirementsStatus: null, onOpen: (i) => opened.push(i), onDelete: (a) => deleted.push(a),
    }));
  });

  const buttons = container.querySelectorAll('button[aria-label="Delete artifact"]');
  assert.equal(buttons.length, 3, 'one delete control per row');
  await act(async () => {
    (buttons[1] as HTMLButtonElement).click();
  });

  assert.deepStrictEqual(deleted, [masterPlan], 'onDelete fired for the clicked row\'s artifact');
  assert.deepStrictEqual(opened, [], 'onOpen never fires from a delete-button click, even though the open control overlays the whole row beneath it');

  await act(async () => { root.unmount(); });
});

// ─── Source shape — reuses badge primitives, does not re-sort ─────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const source = readFileSync(join(__dirname, 'planning-docs-list.tsx'), 'utf-8');

test('reuses the shared NodeStatusBadge/SpinnerBadge primitives rather than a bespoke badge', () => {
  assert.ok(source.includes('NodeStatusBadge'), 'imports/uses NodeStatusBadge for the row type icon');
  assert.ok(source.includes('SpinnerBadge'), 'imports/uses SpinnerBadge for the Draft pill');
});

test('does not reimplement ordering — the incoming artifacts array is consumed, not re-sorted', () => {
  assert.ok(!/\.sort\s*\(/.test(source), 'no local .sort( call — ordering is trusted from the caller');
});
