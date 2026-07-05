import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ModalShell } from './modal-shell';
Object.assign(globalThis, { React });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const base = {
  ariaLabel: 'Demo dialog',
  title: <span>My Title</span>,
  isFullScreen: false,
  onToggleFullScreen: () => {},
  onClose: () => {},
};

// Slots + built-ins + a11y (FR-1, AD-1, NFR-5)
{
  const html = renderToStaticMarkup(
    <ModalShell {...base} footer={<span>FOOT</span>}><div>BODY</div></ModalShell>,
  );
  assert.ok(html.includes('role="dialog"') && html.includes('aria-modal="true"'), 'is a labeled modal dialog (NFR-5)');
  assert.ok(html.includes('aria-label="Demo dialog"'), 'carries the caller aria-label');
  assert.ok(html.includes('My Title'), 'renders the title slot');
  assert.ok(html.includes('BODY'), 'renders the body slot');
  assert.ok(html.includes('FOOT'), 'renders the footer slot when provided');
  assert.ok(html.includes('aria-label="Close"') && html.includes('aria-label="Full screen"'), 'built-in Close + Fullscreen (FR-1)');
  assert.ok(!html.includes('aria-label="Share / copy link"'), 'Share absent when onShare not supplied (AD-1)');
  assert.ok(html.includes('data-[state=open]:fade-in-0') && html.includes('data-[state=closed]:fade-out-0'), 'panel carries combined fade+zoom animation (NFR-1)');
  console.log('✓ shell: slots + built-ins + a11y');
}

// Share appears only when onShare is provided; no hardcoded hex (FR-1, NFR-4)
{
  const html = renderToStaticMarkup(
    <ModalShell {...base} onShare={() => {}}><div>BODY</div></ModalShell>,
  );
  assert.ok(html.includes('aria-label="Share / copy link"'), 'Share shown when onShare provided (FR-1)');
  assert.ok(!/#[0-9a-fA-F]{6}/.test(html), 'no literal hex colors in shell markup (NFR-4)');
  console.log('✓ shell: optional share + house tokens');
}
console.log('\nAll ModalShell tests passed');

// aria-labelledby wiring (P02-T02) — a title id supersedes the aria-label fallback
{
  const html = renderToStaticMarkup(
    <ModalShell {...base} titleId="demo-title-id"><div>BODY</div></ModalShell>,
  );
  assert.ok(html.includes('aria-labelledby="demo-title-id"'), 'dialog references the title element via aria-labelledby');
  assert.ok(!html.includes('aria-label="Demo dialog"'), 'aria-label fallback is dropped once a title id is provided');
  console.log('✓ shell: aria-labelledby supersedes aria-label when a titleId is provided');
}

// --- Interaction tests: focus trap, initial focus, focus restore, live region (P02-T02) ---
// These need a real DOM (focus/activeElement semantics don't exist for
// renderToStaticMarkup), so they use the JSDOM + createRoot + act harness
// already established by instruction-drawer.test.tsx / buffered-stage.test.tsx.

function setupDom(): { container: HTMLDivElement } {
  const dom = new JSDOM(`<!doctype html><html><body><div id="root"></div></body></html>`, {
    url: 'http://localhost:3000/',
  });
  Object.defineProperty(globalThis, 'window', { value: dom.window, writable: true, configurable: true });
  Object.defineProperty(globalThis, 'document', { value: dom.window.document, writable: true, configurable: true });
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, writable: true, configurable: true });
  // base-ui's useButton checks the global HTMLElement when its buttons mount.
  Object.defineProperty(globalThis, 'HTMLElement', { value: dom.window.HTMLElement, writable: true, configurable: true });
  const container = dom.window.document.getElementById('root') as HTMLDivElement;
  return { container };
}

const interactiveBase = {
  ariaLabel: 'Demo dialog',
  titleId: 'demo-title',
  title: <span id="demo-title">Title</span>,
  isFullScreen: false,
  onToggleFullScreen: () => {},
  onClose: () => {},
  onShare: () => {},
};

test('moves focus into the panel on mount (initial focus)', async () => {
  const { container } = setupDom();
  const opener = document.createElement('button');
  opener.textContent = 'Open';
  document.body.appendChild(opener);
  opener.focus();
  assert.equal(document.activeElement, opener, 'the opener starts out focused');

  const { createRoot } = await import('react-dom/client');
  const { act } = await import('react');
  let root!: import('react-dom/client').Root;
  await act(async () => {
    root = createRoot(container);
    root.render(<ModalShell {...interactiveBase}><div>BODY</div></ModalShell>);
  });

  const active = document.activeElement as HTMLElement;
  assert.notEqual(active, opener, 'focus left the opener once the modal mounted');
  assert.ok(container.contains(active), 'focus moved inside the rendered modal');
  assert.equal(active.getAttribute('tabindex'), '-1', 'the panel itself received the initial programmatic focus');

  await act(async () => { root.unmount(); });
});

test('restores focus to the opener after the modal actually unmounts, not merely when dataState flips to closed', async () => {
  const { container } = setupDom();
  const opener = document.createElement('button');
  opener.textContent = 'Open';
  document.body.appendChild(opener);
  opener.focus();

  const { createRoot } = await import('react-dom/client');
  const { act } = await import('react');
  let root!: import('react-dom/client').Root;
  await act(async () => {
    root = createRoot(container);
    root.render(<ModalShell {...interactiveBase}><div>BODY</div></ModalShell>);
  });
  assert.notEqual(document.activeElement, opener, 'the opener no longer holds focus once the modal is open');

  // The parent keeps the modal mounted through its ~200ms exit animation
  // (dataState flips to "closed" first); focus must NOT restore yet.
  await act(async () => {
    root.render(<ModalShell {...interactiveBase} dataState="closed"><div>BODY</div></ModalShell>);
  });
  assert.notEqual(document.activeElement, opener, 'focus is not restored merely because dataState flipped to closed — still mounted');

  // Only once the parent actually unmounts (after the animation) does focus return.
  await act(async () => { root.unmount(); });
  assert.equal(document.activeElement, opener, 'focus returns to the opener once the modal actually unmounts');
});

test('traps Tab within the panel: Tab from the last focusable element wraps to the first, and vice versa', async () => {
  const { container } = setupDom();
  const { createRoot } = await import('react-dom/client');
  const { act } = await import('react');
  let root!: import('react-dom/client').Root;
  await act(async () => {
    root = createRoot(container);
    root.render(<ModalShell {...interactiveBase}><button type="button">Body Button</button></ModalShell>);
  });

  const buttons = Array.from(container.querySelectorAll('button'));
  assert.ok(buttons.length >= 2, 'the panel has multiple focusable elements (share, full screen, close, body button)');
  const first = buttons[0];
  const last = buttons[buttons.length - 1];

  last.focus();
  assert.equal(document.activeElement, last);
  await act(async () => {
    last.dispatchEvent(new (window as unknown as { KeyboardEvent: typeof KeyboardEvent }).KeyboardEvent(
      'keydown', { key: 'Tab', bubbles: true, cancelable: true },
    ));
  });
  assert.equal(document.activeElement, first, 'Tab from the last focusable element wraps to the first');

  first.focus();
  assert.equal(document.activeElement, first);
  await act(async () => {
    first.dispatchEvent(new (window as unknown as { KeyboardEvent: typeof KeyboardEvent }).KeyboardEvent(
      'keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true },
    ));
  });
  assert.equal(document.activeElement, last, 'Shift+Tab from the first focusable element wraps to the last');

  await act(async () => { root.unmount(); });
});

test('renders the live region and updates its text when the announcement changes', async () => {
  const { container } = setupDom();
  const { createRoot } = await import('react-dom/client');
  const { act } = await import('react');
  let root!: import('react-dom/client').Root;
  await act(async () => {
    root = createRoot(container);
    root.render(<ModalShell {...interactiveBase} announcement="First Doc"><div>BODY</div></ModalShell>);
  });

  const live = container.querySelector('[aria-live="polite"]');
  assert.ok(live, 'a live region is rendered');
  assert.equal(live!.textContent, 'First Doc');

  await act(async () => {
    root.render(<ModalShell {...interactiveBase} announcement="Second Doc"><div>BODY</div></ModalShell>);
  });
  assert.equal(live!.textContent, 'Second Doc', 'live region text updates when the active document changes');

  await act(async () => { root.unmount(); });
});
