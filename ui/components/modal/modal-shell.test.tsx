import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ModalShell } from './modal-shell';
(globalThis as any).React = React;

const base = {
  ariaLabel: 'Demo dialog',
  title: createElement('span', null, 'My Title'),
  isFullScreen: false,
  onToggleFullScreen: () => {},
  onClose: () => {},
};

// Slots + built-ins + a11y (FR-1, AD-1, NFR-5)
{
  const html = renderToStaticMarkup(
    createElement(ModalShell, { ...base, footer: createElement('span', null, 'FOOT') },
      createElement('div', null, 'BODY')),
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
    createElement(ModalShell, { ...base, onShare: () => {} }, createElement('div', null, 'BODY')),
  );
  assert.ok(html.includes('aria-label="Share / copy link"'), 'Share shown when onShare provided (FR-1)');
  assert.ok(!/#[0-9a-fA-F]{6}/.test(html), 'no literal hex colors in shell markup (NFR-4)');
  console.log('✓ shell: optional share + house tokens');
}
console.log('\nAll ModalShell tests passed');
