import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// base-ui primitives reached through the wizard resolve `typeof document` once,
// at module-evaluation time, so a jsdom environment must exist *before* the
// modules are first imported — every test loads them dynamically rather than
// via a static top-of-file import.
function setupDom(): HTMLDivElement {
  const dom = new JSDOM(`<!doctype html><html><body><div id="root"></div></body></html>`, {
    url: 'http://localhost:3000/projects',
  });
  Object.defineProperty(globalThis, 'window', { value: dom.window, writable: true, configurable: true });
  Object.defineProperty(globalThis, 'document', { value: dom.window.document, writable: true, configurable: true });
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, writable: true, configurable: true });
  Object.defineProperty(globalThis, 'HTMLElement', { value: dom.window.HTMLElement, writable: true, configurable: true });
  Object.defineProperty(globalThis, 'Element', { value: dom.window.Element, writable: true, configurable: true });
  Object.defineProperty(globalThis, 'Node', { value: dom.window.Node, writable: true, configurable: true });
  Object.defineProperty(globalThis, 'MutationObserver', { value: dom.window.MutationObserver, writable: true, configurable: true });
  Object.defineProperty(globalThis, 'getComputedStyle', { value: dom.window.getComputedStyle.bind(dom.window), writable: true, configurable: true });
  Object.defineProperty(globalThis, 'DOMRect', { value: dom.window.DOMRect, writable: true, configurable: true });
  Object.defineProperty(globalThis, 'Text', { value: dom.window.Text, writable: true, configurable: true });
  Object.defineProperty(globalThis, 'ResizeObserver', {
    value: class { observe() {} unobserve() {} disconnect() {} },
    writable: true,
    configurable: true,
  });
  return dom.window.document.getElementById('root') as HTMLDivElement;
}

async function loadModules() {
  const container = setupDom();
  const button = await import('./approve-gate-button');
  const wizard = await import('@/hooks/use-approval-wizard');
  return { ...button, ...wizard, container };
}

function findButton(text: string): HTMLButtonElement {
  const found = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.includes(text));
  assert.ok(found, `expected a button containing "${text}"`);
  return found!;
}

test('renders the trigger with the given label', async () => {
  const { ApproveGateButton, container } = await loadModules();
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        <ApproveGateButton
          gateEvent="final_approved"
          projectName="PORTFOLIO-2"
          documentName="FINAL-REVIEW.md"
          label="Approve"
        />,
      );
    });
    assert.ok(findButton('Approve'));
    assert.equal(document.body.querySelector('[role="dialog"]'), null, 'the trigger owns no dialog of its own');
  } finally {
    await act(async () => { root.unmount(); });
  }
});

test('clicking hands the gate to the approval wizard instead of opening anything itself', async () => {
  // The trigger deliberately owns no dialog state: it is rendered by dag-widget
  // state views the pipeline can swap out mid-approval, so anything it owned
  // would be destroyed by the approval it just performed. All it may do is ask
  // the hoisted provider to open.
  const { ApproveGateButton, ApprovalWizardContext, container } = await loadModules();
  const root = createRoot(container);
  const opened: unknown[] = [];
  try {
    await act(async () => {
      root.render(
        <ApprovalWizardContext.Provider value={{ openApprovalWizard: (req) => { opened.push(req); } }}>
          <ApproveGateButton
            gateEvent="final_approved"
            projectName="PORTFOLIO-2"
            documentName="FINAL-REVIEW.md"
            label="Approve"
          />
        </ApprovalWizardContext.Provider>,
      );
    });

    await act(async () => { findButton('Approve').click(); });

    assert.deepEqual(opened, [{
      gateEvent: 'final_approved',
      projectName: 'PORTFOLIO-2',
      documentName: 'FINAL-REVIEW.md',
    }]);
  } finally {
    await act(async () => { root.unmount(); });
  }
});

test('unmounting the trigger cannot tear down an open wizard', async () => {
  // Regression: the caller re-renders without the trigger the instant the gate
  // resolves (final-review-view gates it on `deriveFinalGatePending`, which
  // flips false the moment the approval lands). That must not disturb the
  // wizard, which lives in the provider above — modelled here by the provider
  // outliving the trigger it rendered.
  const { ApproveGateButton, ApprovalWizardContext, container } = await loadModules();
  const root = createRoot(container);
  const opened: unknown[] = [];
  const value = { openApprovalWizard: (req: unknown) => { opened.push(req); } };
  try {
    const tree = (showTrigger: boolean) => (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      <ApprovalWizardContext.Provider value={value as any}>
        <div data-testid="wizard-host">still here</div>
        {showTrigger && (
          <ApproveGateButton
            gateEvent="final_approved"
            projectName="PORTFOLIO-2"
            documentName="FINAL-REVIEW.md"
            label="Approve"
          />
        )}
      </ApprovalWizardContext.Provider>
    );

    await act(async () => { root.render(tree(true)); });
    await act(async () => { findButton('Approve').click(); });
    assert.equal(opened.length, 1);

    // The gate resolves; the caller stops rendering the trigger.
    await act(async () => { root.render(tree(false)); });

    assert.equal(
      Array.from(document.body.querySelectorAll('button')).some((b) => b.textContent?.includes('Approve')),
      false,
      'the resolved gate stops offering Approve',
    );
    assert.ok(
      document.body.querySelector('[data-testid="wizard-host"]'),
      'the wizard host is untouched by the trigger unmounting',
    );
  } finally {
    await act(async () => { root.unmount(); });
  }
});
