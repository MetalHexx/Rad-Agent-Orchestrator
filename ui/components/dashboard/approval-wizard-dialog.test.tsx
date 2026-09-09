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

// base-ui's Dialog and Select primitives resolve `typeof document` once, at
// module-evaluation time, so a jsdom environment must exist *before* the
// module is first imported — every test loads it dynamically rather than
// via a static top-of-file import. Mirrors delete-project-dialog.test.tsx.
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
  const raf = (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0) as unknown as number;
  const caf = (id: number) => clearTimeout(id);
  Object.defineProperty(globalThis, 'requestAnimationFrame', { value: raf, writable: true, configurable: true });
  Object.defineProperty(globalThis, 'cancelAnimationFrame', { value: caf, writable: true, configurable: true });
  Object.defineProperty(globalThis, 'ResizeObserver', {
    value: class { observe() {} unobserve() {} disconnect() {} },
    writable: true,
    configurable: true,
  });
  return dom.window.document.getElementById('root') as HTMLDivElement;
}

async function loadModule() {
  const container = setupDom();
  const mod = await import('./approval-wizard-dialog');
  return { ...mod, container };
}

function okResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

function failedResponse(status: number, body: unknown): Response {
  return { ok: false, status, json: async () => body } as unknown as Response;
}

interface Routes {
  portfolio?: () => Response | Promise<Response>;
  gate?: () => Response | Promise<Response>;
  sessions?: () => Response | Promise<Response>;
  launch?: () => Response | Promise<Response>;
}

/** Routes each endpoint independently, recording call order and sent bodies. */
function seedFetch(routes: Routes): {
  calls: string[];
  bodies: Record<string, unknown>;
  restore: () => void;
} {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  const bodies: Record<string, unknown> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = async (url: string, init?: { body?: string }) => {
    if (url.includes('/portfolio')) {
      calls.push('portfolio');
      return routes.portfolio ? routes.portfolio() : okResponse({ portfolio: null });
    }
    if (url.includes('/debrief/launch')) {
      calls.push('launch');
      if (init?.body) bodies.launch = JSON.parse(init.body);
      return routes.launch ? routes.launch() : okResponse({ launched: true });
    }
    if (url.includes('/sessions')) {
      calls.push('sessions');
      return routes.sessions ? routes.sessions() : okResponse({ sessions: [], totalActiveTimeMs: 0 });
    }
    if (url.includes('/gate')) {
      calls.push('gate');
      return routes.gate ? routes.gate() : okResponse({ success: true, action: 'final_approved' });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  return { calls, bodies, restore: () => { globalThis.fetch = originalFetch; } };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
}

function findButton(text: string): HTMLButtonElement {
  const button = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.includes(text));
  assert.ok(button, `expected a button containing "${text}"`);
  return button!;
}

function hasText(text: string): boolean {
  return (document.body.textContent ?? '').includes(text);
}

const PORTFOLIO_MEMBER = () => okResponse({ portfolio: { name: 'PORTFOLIO' } });

/** Mounts the wizard open, on a final approval, and clicks through to confirm. */
async function openAndConfirm(routes: Routes, projectName = 'PORTFOLIO-2') {
  const seeded = seedFetch(routes);
  const { ApprovalWizardDialog, container } = await loadModule();
  const root = createRoot(container);
  let closed = 0;
  await act(async () => {
    root.render(
      <ApprovalWizardDialog
        gateEvent="final_approved"
        projectName={projectName}
        documentName="FINAL-REVIEW.md"
        open
        onClose={() => { closed += 1; }}
      />,
    );
  });
  await act(async () => { await flush(); });
  await act(async () => {
    findButton('Confirm Approval').click();
    await flush();
  });
  return { seeded, root, closedCount: () => closed };
}

test('the wizard opens on the confirmation step naming the document', async () => {
  const { restore } = seedFetch({});
  const { ApprovalWizardDialog, container } = await loadModule();
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        <ApprovalWizardDialog
          gateEvent="final_approved"
          projectName="PORTFOLIO-2"
          documentName="FINAL-REVIEW.md"
          open
          onClose={() => {}}
        />,
      );
    });
    assert.ok(hasText('Approve Final Review'), 'the confirmation step renders');
    assert.ok(hasText('FINAL-REVIEW.md'), 'it names the document being approved');
    assert.ok(findButton('Confirm Approval'));
  } finally {
    restore();
    await act(async () => { root.unmount(); });
  }
});

test('the debrief question is asked BEFORE the approval is committed', async () => {
  // The regression this whole wizard exists for. Approving a final review
  // completes the graph, which swaps the dag-widget card from finalReviewView
  // to completeView — destroying whatever subtree the approval was launched
  // from. Asking the debrief question first makes that race unreachable
  // instead of merely survivable, so the ordering is the invariant under test:
  // at the moment the debrief prompt is on screen, NO gate call has happened.
  const { seeded, root } = await openAndConfirm({ portfolio: PORTFOLIO_MEMBER });
  try {
    assert.ok(hasText('Record what this iteration delivered?'), 'the debrief question is on screen');
    assert.equal(
      seeded.calls.includes('gate'),
      false,
      'no approval has been committed while the operator is still being asked',
    );
  } finally {
    seeded.restore();
    await act(async () => { root.unmount(); });
  }
});

test('answering "Approve & debrief" commits the approval first, then launches the debrief', async () => {
  const { seeded, root, closedCount } = await openAndConfirm({ portfolio: PORTFOLIO_MEMBER });
  try {
    await act(async () => {
      findButton('Approve & debrief').click();
      await flush();
    });

    const gateAt = seeded.calls.indexOf('gate');
    const launchAt = seeded.calls.indexOf('launch');
    assert.ok(gateAt >= 0, 'the approval was committed');
    assert.ok(launchAt >= 0, 'the debrief was launched');
    assert.ok(gateAt < launchAt, 'approval commits before the debrief launches');
    assert.equal(closedCount(), 1, 'the wizard closes once both operations land');
  } finally {
    seeded.restore();
    await act(async () => { root.unmount(); });
  }
});

test('answering "Not now" commits the approval and launches nothing', async () => {
  const { seeded, root, closedCount } = await openAndConfirm({ portfolio: PORTFOLIO_MEMBER });
  try {
    await act(async () => {
      findButton('Not now').click();
      await flush();
    });

    assert.ok(seeded.calls.includes('gate'), 'the approval still commits');
    assert.equal(seeded.calls.includes('launch'), false, 'declining launches no debrief');
    assert.equal(closedCount(), 1, 'the wizard closes');
  } finally {
    seeded.restore();
    await act(async () => { root.unmount(); });
  }
});

test('a non-member skips the debrief question and commits straight through', async () => {
  const { seeded, root, closedCount } = await openAndConfirm(
    { portfolio: () => okResponse({ portfolio: null }) },
    'SOLO-PROJECT',
  );
  try {
    assert.equal(hasText('Record what this iteration delivered?'), false, 'no debrief question for a non-member');
    assert.ok(seeded.calls.includes('gate'), 'the approval committed directly');
    assert.equal(seeded.calls.includes('launch'), false);
    assert.equal(closedCount(), 1, 'the wizard closes');
  } finally {
    seeded.restore();
    await act(async () => { root.unmount(); });
  }
});

test('a plan approval never asks about a debrief and never looks one up', async () => {
  const seeded = seedFetch({ gate: () => okResponse({ success: true, action: 'plan_approved' }) });
  const { ApprovalWizardDialog, container } = await loadModule();
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        <ApprovalWizardDialog
          gateEvent="plan_approved"
          projectName="PORTFOLIO-2"
          documentName="MASTER-PLAN.md"
          open
          onClose={() => {}}
        />,
      );
    });
    await act(async () => {
      findButton('Confirm Approval').click();
      await flush();
    });

    assert.equal(hasText('Record what this iteration delivered?'), false, 'plan approval never offers a debrief');
    assert.equal(seeded.calls.includes('portfolio'), false, 'and never pays for the membership lookup');
    assert.ok(seeded.calls.includes('gate'), 'the plan approval committed');
  } finally {
    seeded.restore();
    await act(async () => { root.unmount(); });
  }
});

test('a failed approval returns to the confirmation step, shows the error, and launches no debrief', async () => {
  const { seeded, root, closedCount } = await openAndConfirm({
    portfolio: PORTFOLIO_MEMBER,
    gate: () => failedResponse(409, { error: 'Gate already fired' }),
  });
  try {
    await act(async () => {
      findButton('Approve & debrief').click();
      await flush();
    });

    assert.ok(hasText('Approve Final Review'), 'the confirmation step is back');
    const alert = document.body.querySelector('[role="alert"]');
    assert.ok(alert, 'the gate error banner renders');
    assert.ok(alert!.textContent?.includes('Gate already fired'));
    assert.equal(seeded.calls.includes('launch'), false, 'a debrief never launches for an approval that failed');
    assert.equal(closedCount(), 0, 'the wizard stays open so the operator can retry');
  } finally {
    seeded.restore();
    await act(async () => { root.unmount(); });
  }
});

test('a failed debrief launch reports that the approval still landed', async () => {
  const { seeded, root, closedCount } = await openAndConfirm({
    portfolio: PORTFOLIO_MEMBER,
    launch: () => failedResponse(500, { error: 'no terminal' }),
  });
  try {
    await act(async () => {
      findButton('Approve & debrief').click();
      await flush();
    });

    assert.ok(seeded.calls.includes('gate'), 'the approval committed');
    assert.ok(hasText('The approval already succeeded'), 'the failure leads with what did not break');
    assert.equal(closedCount(), 0, 'the wizard stays up to report it rather than vanishing');
    assert.ok(findButton('Close'), 'and offers only a way out, never a retry');
  } finally {
    seeded.restore();
    await act(async () => { root.unmount(); });
  }
});

test('the debrief launches in the harness the project was last worked in', async () => {
  // Asserted through what actually gets launched rather than the Select's
  // rendered label — base-ui resolves that label through machinery jsdom does
  // not drive, and the launched harness is the behaviour that matters anyway.
  const { seeded, root } = await openAndConfirm({
    portfolio: PORTFOLIO_MEMBER,
    sessions: () => okResponse({ sessions: [{ harness: 'copilot' }], totalActiveTimeMs: 0 }),
  });
  try {
    await act(async () => { await flush(); });
    await act(async () => {
      findButton('Approve & debrief').click();
      await flush();
    });
    assert.deepEqual(seeded.bodies.launch, { harness: 'copilot' }, 'the inferred harness is what launches');
  } finally {
    seeded.restore();
    await act(async () => { root.unmount(); });
  }
});

test('the debrief defaults to claude when the harness cannot be inferred', async () => {
  const { seeded, root } = await openAndConfirm({
    portfolio: PORTFOLIO_MEMBER,
    sessions: () => failedResponse(500, { error: 'unavailable' }),
  });
  try {
    await act(async () => { await flush(); });
    await act(async () => {
      findButton('Approve & debrief').click();
      await flush();
    });
    assert.deepEqual(seeded.bodies.launch, { harness: 'claude' }, 'a failed lookup never blocks the debrief');
  } finally {
    seeded.restore();
    await act(async () => { root.unmount(); });
  }
});
