import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { DeletionItem, DeletionReport, DeletionSkip } from '@rad-orchestration/work-graph';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// The component under test wraps @base-ui/react's Dialog primitive, whose
// internal hooks resolve `typeof window !== 'undefined'` (and reach for
// `requestAnimationFrame`/`Node`/etc.) once, at module-evaluation time. A
// jsdom environment must therefore exist *before* the module is first
// imported, so every test loads it dynamically through this helper rather
// than via a static top-of-file import.
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
  return dom.window.document.getElementById('root') as HTMLDivElement;
}

/** setupDom() + the deferred import, in the required order. Safe to call
 *  from every test — the module import is cached after the first call. */
async function loadModule() {
  const container = setupDom();
  const mod = await import('./delete-project-dialog');
  return { ...mod, container };
}

const removeItem: DeletionItem = {
  kind: 'project-dir', label: 'Project directory', path: '/demo', exists: true, disposition: 'remove',
};
const protectedItem: DeletionItem = {
  kind: 'graph-edges', label: 'Graph edges', path: null, exists: true,
  disposition: 'protected', protectedReason: 'Referenced by a related project.',
};
const worktreeItem: DeletionItem = {
  kind: 'worktree', label: 'repo-a', path: '~/worktrees/repo-a', exists: true, disposition: 'remove',
};
const sideProjectItem: DeletionItem = {
  kind: 'side-project-repo', label: 'repo-b', path: '~/side-projects/repo-b', exists: true, disposition: 'remove',
};
const graphEdgesRemoveItem: DeletionItem = {
  kind: 'graph-edges', label: 'Graph edges', path: null, exists: true, disposition: 'remove',
};

function findCheckbox(label: string): HTMLElement | undefined {
  return Array.from(document.body.querySelectorAll<HTMLElement>('[role="checkbox"]'))
    .find((el) => el.getAttribute('aria-label')?.includes(label));
}

// ─── Pure logic ────────────────────────────────────────────────────────────

test('groupByDisposition splits items by disposition', async () => {
  const { groupByDisposition } = await loadModule();
  const { toRemove, protected: protectedItems } = groupByDisposition([removeItem, protectedItem]);
  assert.deepEqual(toRemove, [removeItem]);
  assert.deepEqual(protectedItems, [protectedItem]);
});

test('isRetryMode is true only once an attempt left the report incomplete', async () => {
  const { isRetryMode } = await loadModule();
  assert.equal(isRetryMode(null), false);
  assert.equal(isRetryMode({ project: 'x', items: [], complete: true }), false);
  assert.equal(isRetryMode({ project: 'x', items: [], complete: false }), true);
});

test('confirmButtonLabel is distinct across pending / first-attempt / retry', async () => {
  const { confirmButtonLabel } = await loadModule();
  const incomplete: DeletionReport = { project: 'x', items: [], complete: false };
  const pending = confirmButtonLabel(null, true);
  const firstAttempt = confirmButtonLabel(null, false);
  const retry = confirmButtonLabel(incomplete, false);
  assert.notEqual(pending, firstAttempt);
  assert.notEqual(retry, firstAttempt);
  // Pending always wins, even mid-retry.
  assert.equal(confirmButtonLabel(incomplete, true), pending);
});

test('describeKind gives every DeletionItem kind its own label', async () => {
  const { describeKind } = await loadModule();
  const kinds: DeletionItem['kind'][] = ['project-dir', 'worktree', 'side-project-repo', 'graph-edges'];
  const labels = kinds.map(describeKind);
  assert.equal(new Set(labels).size, kinds.length);
});

// ─── Rendered behavior ───────────────────────────────────────────────────────

test('the confirm and cancel actions are disabled while a delete is in flight', async () => {
  const { DeleteProjectDialog, container } = await loadModule();
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        <DeleteProjectDialog
          open={true}
          onOpenChange={() => {}}
          projectName="DEMO"
          plan={{ project: 'DEMO', items: [removeItem] }}
          planError={null}
          report={null}
          isPending={true}
          onConfirm={() => {}}
        />,
      );
    });

    const buttons = Array.from(document.body.querySelectorAll('button'));
    const named = buttons.filter((b) => b.textContent && b.textContent.trim().length > 0);
    assert.ok(named.length >= 2, 'both Cancel and Confirm render as named buttons');
    for (const button of named) {
      assert.equal(button.hasAttribute('disabled'), true, `button "${button.textContent}" is disabled while pending`);
    }
    const confirmButton = named.find((b) => b.getAttribute('aria-busy') === 'true');
    assert.ok(confirmButton, 'the confirm button carries aria-busy while pending');
  } finally {
    await act(async () => { root.unmount(); });
  }
});

test('a partial delete keeps the dialog open, marks the unresolved item, and offers retry', async () => {
  const { DeleteProjectDialog, confirmButtonLabel, container } = await loadModule();
  const root = createRoot(container);
  const report: DeletionReport = {
    project: 'DEMO',
    items: [
      { ...removeItem, outcome: 'failed', error: 'permission denied' },
      { ...protectedItem, outcome: 'protected' },
    ],
    complete: false,
  };
  try {
    await act(async () => {
      root.render(
        <DeleteProjectDialog
          open={true}
          onOpenChange={() => {}}
          projectName="DEMO"
          plan={null}
          planError={null}
          report={report}
          isPending={false}
          onConfirm={() => {}}
        />,
      );
    });

    // The dialog is still mounted and open — no caller-side close happened.
    const dialogEl = document.body.querySelector('[role="dialog"]');
    assert.ok(dialogEl, 'the dialog stays open on a partial failure');

    const alertEl = document.body.querySelector('[role="alert"]');
    assert.ok(alertEl, 'the partial outcome is announced via role="alert"');

    const items = Array.from(document.body.querySelectorAll('li'));
    assert.equal(items.length, report.items.length, 'both the unresolved and the protected item render as list rows');
    const unresolvedRow = items.find((li) => li.className.includes('text-destructive'));
    assert.ok(unresolvedRow, 'the failed item is visually distinguished from the rest');
    assert.ok(unresolvedRow!.textContent?.includes('permission denied'), 'the failure reason is shown');

    const expectedLabel = confirmButtonLabel(report, false);
    const confirmButton = Array.from(document.body.querySelectorAll('button'))
      .find((b) => b.textContent?.includes(expectedLabel));
    assert.ok(confirmButton, 'the confirm action is relabelled for retry');
    assert.equal(confirmButton!.hasAttribute('disabled'), false, 'retry stays available (not pending)');
  } finally {
    await act(async () => { root.unmount(); });
  }
});

// ─── Selective delete ────────────────────────────────────────────────────────

test('only worktree and side-project-repo rows get a checkbox, checked by default', async () => {
  const { DeleteProjectDialog, container } = await loadModule();
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        <DeleteProjectDialog
          open={true}
          onOpenChange={() => {}}
          projectName="DEMO"
          plan={{ project: 'DEMO', items: [removeItem, worktreeItem, sideProjectItem, graphEdgesRemoveItem] }}
          planError={null}
          report={null}
          isPending={false}
          onConfirm={() => {}}
        />,
      );
    });

    const checkboxes = Array.from(document.body.querySelectorAll('[role="checkbox"]'));
    assert.equal(checkboxes.length, 2, 'only the worktree and side-project-repo rows get a checkbox');
    for (const cb of checkboxes) {
      assert.equal(cb.getAttribute('aria-checked'), 'true', 'checked by default');
    }
    assert.ok(findCheckbox('repo-a'), 'the worktree checkbox names its row via aria-label');
    assert.ok(findCheckbox('repo-b'), 'the side-project-repo checkbox names its row via aria-label');
  } finally {
    await act(async () => { root.unmount(); });
  }
});

test('unchecking a row and confirming hands onConfirm exactly that skip entry', async () => {
  const { DeleteProjectDialog, container } = await loadModule();
  const root = createRoot(container);
  let confirmedSkip: DeletionSkip[] | undefined;
  try {
    await act(async () => {
      root.render(
        <DeleteProjectDialog
          open={true}
          onOpenChange={() => {}}
          projectName="DEMO"
          plan={{ project: 'DEMO', items: [worktreeItem, sideProjectItem] }}
          planError={null}
          report={null}
          isPending={false}
          onConfirm={(skip) => { confirmedSkip = skip; }}
        />,
      );
    });

    const worktreeCheckbox = findCheckbox('repo-a')!;
    await act(async () => { worktreeCheckbox.click(); });
    assert.equal(worktreeCheckbox.getAttribute('aria-checked'), 'false', 'unchecked after a click');

    const confirmButton = Array.from(document.body.querySelectorAll('button'))
      .find((b) => b.textContent?.includes('Delete project'))!;
    await act(async () => { confirmButton.click(); });

    assert.deepEqual(confirmedSkip, [{ kind: 'worktree', label: 'repo-a' }]);
  } finally {
    await act(async () => { root.unmount(); });
  }
});

test('closing and reopening resets the selection to all-checked', async () => {
  const { DeleteProjectDialog, container } = await loadModule();
  const root = createRoot(container);
  try {
    const render = (open: boolean) => root.render(
      <DeleteProjectDialog
        open={open}
        onOpenChange={() => {}}
        projectName="DEMO"
        plan={{ project: 'DEMO', items: [worktreeItem] }}
        planError={null}
        report={null}
        isPending={false}
        onConfirm={() => {}}
      />,
    );

    await act(async () => { render(true); });
    const checkbox = findCheckbox('repo-a')!;
    await act(async () => { checkbox.click(); });
    assert.equal(checkbox.getAttribute('aria-checked'), 'false', 'unchecked before closing');

    await act(async () => { render(false); });
    await act(async () => { render(true); });

    assert.equal(findCheckbox('repo-a')!.getAttribute('aria-checked'), 'true', 'checked again after reopening');
  } finally {
    await act(async () => { root.unmount(); });
  }
});

test('a new report resets the selection even while the dialog stays open (retry starts clean)', async () => {
  const { DeleteProjectDialog, container } = await loadModule();
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        <DeleteProjectDialog
          open={true}
          onOpenChange={() => {}}
          projectName="DEMO"
          plan={{ project: 'DEMO', items: [worktreeItem] }}
          planError={null}
          report={null}
          isPending={false}
          onConfirm={() => {}}
        />,
      );
    });
    const checkbox = findCheckbox('repo-a')!;
    await act(async () => { checkbox.click(); });
    assert.equal(checkbox.getAttribute('aria-checked'), 'false', 'unchecked before the retry report lands');

    const retryReport: DeletionReport = {
      project: 'DEMO',
      items: [{ ...worktreeItem, outcome: 'failed', error: 'busy' }],
      complete: false,
    };
    await act(async () => {
      root.render(
        <DeleteProjectDialog
          open={true}
          onOpenChange={() => {}}
          projectName="DEMO"
          plan={{ project: 'DEMO', items: [worktreeItem] }}
          planError={null}
          report={retryReport}
          isPending={false}
          onConfirm={() => {}}
        />,
      );
    });

    assert.equal(findCheckbox('repo-a')!.getAttribute('aria-checked'), 'true', 'checked again once a new report lands');
  } finally {
    await act(async () => { root.unmount(); });
  }
});

test('a skipped result renders as a neutral kept note, not a failure', async () => {
  const { DeleteProjectDialog, container } = await loadModule();
  const root = createRoot(container);
  const report: DeletionReport = {
    project: 'DEMO',
    items: [{ ...worktreeItem, outcome: 'skipped' }],
    complete: true,
  };
  try {
    await act(async () => {
      root.render(
        <DeleteProjectDialog
          open={true}
          onOpenChange={() => {}}
          projectName="DEMO"
          plan={null}
          planError={null}
          report={report}
          isPending={false}
          onConfirm={() => {}}
        />,
      );
    });

    const rows = Array.from(document.body.querySelectorAll('li'));
    const skippedRow = rows.find((li) => li.textContent?.includes('repo-a'));
    assert.ok(skippedRow, 'the skipped row renders');
    assert.ok(skippedRow!.textContent?.includes('Kept'), 'a neutral kept note is shown');
    assert.equal(skippedRow!.className.includes('text-destructive'), false, 'a skipped row is not styled as a failure');
  } finally {
    await act(async () => { root.unmount(); });
  }
});

test('rows render the label with no trailing colon and no path text', async () => {
  const { DeleteProjectDialog, container } = await loadModule();
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        <DeleteProjectDialog
          open={true}
          onOpenChange={() => {}}
          projectName="DEMO"
          plan={{ project: 'DEMO', items: [worktreeItem, graphEdgesRemoveItem] }}
          planError={null}
          report={null}
          isPending={false}
          onConfirm={() => {}}
        />,
      );
    });

    const rows = Array.from(document.body.querySelectorAll('li'));
    const worktreeRow = rows.find((li) => li.textContent?.includes('repo-a'))!;
    assert.equal(worktreeRow.textContent?.includes(':'), false, 'the label carries no trailing colon');
    assert.equal(worktreeRow.textContent?.includes('~/worktrees/repo-a'), false, 'the directory path is not rendered');
    assert.equal(worktreeRow.querySelector('.block.text-muted-foreground'), null, 'no path block element renders');

    const graphEdgesRow = rows.find((li) => li.textContent?.includes('Graph edges'))!;
    assert.equal(graphEdgesRow.textContent?.includes(':'), false, 'a row with no path still carries no trailing colon');
  } finally {
    await act(async () => { root.unmount(); });
  }
});

test('the "Will be removed" list renders as a bulleted list', async () => {
  const { DeleteProjectDialog, container } = await loadModule();
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        <DeleteProjectDialog
          open={true}
          onOpenChange={() => {}}
          projectName="DEMO"
          plan={{ project: 'DEMO', items: [removeItem, graphEdgesRemoveItem] }}
          planError={null}
          report={null}
          isPending={false}
          onConfirm={() => {}}
        />,
      );
    });

    const headings = Array.from(document.body.querySelectorAll('h3'));
    const willBeRemovedHeading = headings.find((h) => h.textContent?.includes('Will be removed'))!;
    const list = willBeRemovedHeading.nextElementSibling as HTMLUListElement;
    assert.ok(list.className.includes('list-disc'), 'the "Will be removed" list carries a visible bullet style');
  } finally {
    await act(async () => { root.unmount(); });
  }
});

test('the dialog description tells the operator that telemetry survives project deletion', async () => {
  const { DeleteProjectDialog, container } = await loadModule();
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        <DeleteProjectDialog
          open={true}
          onOpenChange={() => {}}
          projectName="DEMO"
          plan={{ project: 'DEMO', items: [removeItem] }}
          planError={null}
          report={null}
          isPending={false}
          onConfirm={() => {}}
        />,
      );
    });

    const text = document.body.textContent ?? '';
    assert.ok(/attribut/i.test(text), 'mentions that recorded sessions stop being attributed to the project');
    assert.ok(/(usage|transcript|checkpoint|spend)/i.test(text), 'mentions that telemetry itself is kept');
    // The existing red workspace-sharing warning box is untouched — still present, still its own paragraph.
    const warning = Array.from(document.body.querySelectorAll('p')).find((p) => p.textContent?.startsWith('Warning:'));
    assert.ok(warning, 'the workspace-sharing warning callout is unchanged');
  } finally {
    await act(async () => { root.unmount(); });
  }
});

test('the warning callout reads "Warning: …" and carries the soft-red tokens', async () => {
  const { DeleteProjectDialog, container } = await loadModule();
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        <DeleteProjectDialog
          open={true}
          onOpenChange={() => {}}
          projectName="DEMO"
          plan={{ project: 'DEMO', items: [worktreeItem] }}
          planError={null}
          report={null}
          isPending={false}
          onConfirm={() => {}}
        />,
      );
    });

    const warning = Array.from(document.body.querySelectorAll('p')).find((p) => p.textContent?.startsWith('Warning:'));
    assert.ok(warning, 'the warning paragraph reads "Warning: …" for assistive tech');
    const style = warning!.getAttribute('style') ?? '';
    assert.ok(style.includes('var(--model-red)'), 'carries the model-red token');
    assert.ok(style.includes('var(--color-error-border)'), 'carries the error-border token');
    assert.ok(style.includes('color-mix(in oklab, var(--model-red) 9%, transparent)'), 'carries the soft-red background mix');
  } finally {
    await act(async () => { root.unmount(); });
  }
});

// ─── Two-section split ──────────────────────────────────────────────────────

test('both mandatory and optional items render: "Will be removed" with no checkboxes, "Optionally removed" with checkboxes', async () => {
  const { DeleteProjectDialog, container } = await loadModule();
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        <DeleteProjectDialog
          open={true}
          onOpenChange={() => {}}
          projectName="DEMO"
          plan={{ project: 'DEMO', items: [removeItem, graphEdgesRemoveItem, worktreeItem, sideProjectItem] }}
          planError={null}
          report={null}
          isPending={false}
          onConfirm={() => {}}
        />,
      );
    });

    const headings = Array.from(document.body.querySelectorAll('h3'));
    const willBeRemovedHeading = headings.find((h) => h.textContent?.includes('Will be removed'));
    const optionallyRemovedHeading = headings.find((h) => h.textContent?.includes('Optionally removed'));
    assert.ok(willBeRemovedHeading, 'the "Will be removed" heading is present');
    assert.ok(optionallyRemovedHeading, 'the "Optionally removed" heading is present');

    const checkboxes = Array.from(document.body.querySelectorAll('[role="checkbox"]'));
    assert.equal(checkboxes.length, 2, 'only the two checkable items (worktree, side-project-repo) get checkboxes');

    const allRows = Array.from(document.body.querySelectorAll('li'));
    const repoARow = allRows.find((li) => li.textContent?.includes('repo-a'));
    const repoBRow = allRows.find((li) => li.textContent?.includes('repo-b'));
    const projectDirRow = allRows.find((li) => li.textContent?.includes('Project directory'));
    const graphEdgesRow = allRows.find((li) => li.textContent?.includes('Graph edges'));

    assert.ok(repoARow?.parentElement?.previousElementSibling?.textContent?.includes('Optionally removed'), 'worktree renders in "Optionally removed"');
    assert.ok(repoBRow?.parentElement?.previousElementSibling?.textContent?.includes('Optionally removed'), 'side-project-repo renders in "Optionally removed"');
    assert.ok(projectDirRow?.parentElement?.previousElementSibling?.textContent?.includes('Will be removed'), 'project-dir renders in "Will be removed"');
    assert.ok(graphEdgesRow?.parentElement?.previousElementSibling?.textContent?.includes('Will be removed'), 'graph-edges renders in "Will be removed"');

    const mandatoryCheckboxes = Array.from(document.body.querySelectorAll('h3'))
      .filter((h) => h.textContent?.includes('Will be removed'))
      .map((h) => h.closest('div'))
      .flatMap((div) => div ? Array.from(div.querySelectorAll('[role="checkbox"]')) : []);
    assert.equal(mandatoryCheckboxes.length, 0, 'the "Will be removed" section contains no checkboxes');
  } finally {
    await act(async () => { root.unmount(); });
  }
});

test('all mandatory items (no optional): "Optionally removed" section is absent and shows "Nothing to remove"', async () => {
  const { DeleteProjectDialog, container } = await loadModule();
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        <DeleteProjectDialog
          open={true}
          onOpenChange={() => {}}
          projectName="DEMO"
          plan={{ project: 'DEMO', items: [removeItem, graphEdgesRemoveItem] }}
          planError={null}
          report={null}
          isPending={false}
          onConfirm={() => {}}
        />,
      );
    });

    const headings = Array.from(document.body.querySelectorAll('h3'));
    const optionallyRemovedHeading = headings.find((h) => h.textContent?.includes('Optionally removed'));
    assert.equal(optionallyRemovedHeading, undefined, 'the "Optionally removed" heading is absent when no optional items exist');

    const checkboxes = Array.from(document.body.querySelectorAll('[role="checkbox"]'));
    assert.equal(checkboxes.length, 0, 'no checkboxes render when all items are mandatory');

    const allRows = Array.from(document.body.querySelectorAll('li'));
    assert.equal(allRows.length, 2, 'both mandatory items render as rows');
  } finally {
    await act(async () => { root.unmount(); });
  }
});

test('unchecking a row in "Optionally removed" and confirming still sends exactly that skip entry', async () => {
  const { DeleteProjectDialog, container } = await loadModule();
  const root = createRoot(container);
  let confirmedSkip: DeletionSkip[] | undefined;
  try {
    await act(async () => {
      root.render(
        <DeleteProjectDialog
          open={true}
          onOpenChange={() => {}}
          projectName="DEMO"
          plan={{ project: 'DEMO', items: [removeItem, worktreeItem, sideProjectItem] }}
          planError={null}
          report={null}
          isPending={false}
          onConfirm={(skip) => { confirmedSkip = skip; }}
        />,
      );
    });

    const worktreeCheckbox = findCheckbox('repo-a')!;
    await act(async () => { worktreeCheckbox.click(); });
    assert.equal(worktreeCheckbox.getAttribute('aria-checked'), 'false', 'worktree checkbox is unchecked');

    const confirmButton = Array.from(document.body.querySelectorAll('button'))
      .find((b) => b.textContent?.includes('Delete project'))!;
    await act(async () => { confirmButton.click(); });

    assert.deepEqual(confirmedSkip, [{ kind: 'worktree', label: 'repo-a' }], 'skip entry is sent for the unchecked row only');
  } finally {
    await act(async () => { root.unmount(); });
  }
});

// ─── Portfolio-specific block ────────────────────────────────────────────────

test('the portfolio explanatory block renders for a portfolio project', async () => {
  const { DeleteProjectDialog, container } = await loadModule();
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        <DeleteProjectDialog
          open={true}
          onOpenChange={() => {}}
          projectName="DEMO"
          plan={{ project: 'DEMO', items: [removeItem] }}
          planError={null}
          report={null}
          isPending={false}
          onConfirm={() => {}}
          projectType="portfolio"
        />,
      );
    });

    const block = document.body.querySelector('[role="note"]');
    assert.ok(block, 'a block with an explanatory role renders for a portfolio project');
    assert.ok(block!.textContent && block!.textContent.trim().length > 0, 'the block carries explanatory content');
  } finally {
    await act(async () => { root.unmount(); });
  }
});

test('the portfolio explanatory block is absent for a standard project and when projectType is omitted', async () => {
  const { DeleteProjectDialog, container } = await loadModule();
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        <DeleteProjectDialog
          open={true}
          onOpenChange={() => {}}
          projectName="DEMO"
          plan={{ project: 'DEMO', items: [removeItem] }}
          planError={null}
          report={null}
          isPending={false}
          onConfirm={() => {}}
          projectType="standard"
        />,
      );
    });
    assert.equal(document.body.querySelector('[role="note"]'), null, 'no portfolio block for a standard project');

    await act(async () => {
      root.render(
        <DeleteProjectDialog
          open={true}
          onOpenChange={() => {}}
          projectName="DEMO"
          plan={{ project: 'DEMO', items: [removeItem] }}
          planError={null}
          report={null}
          isPending={false}
          onConfirm={() => {}}
        />,
      );
    });
    assert.equal(document.body.querySelector('[role="note"]'), null, 'no portfolio block when projectType is omitted entirely');
  } finally {
    await act(async () => { root.unmount(); });
  }
});

test('the confirm handler payload for a portfolio project is byte-identical to the non-portfolio mechanics', async () => {
  const { DeleteProjectDialog, container } = await loadModule();
  const root = createRoot(container);
  let confirmedSkip: DeletionSkip[] | undefined;
  try {
    await act(async () => {
      root.render(
        <DeleteProjectDialog
          open={true}
          onOpenChange={() => {}}
          projectName="DEMO"
          plan={{ project: 'DEMO', items: [worktreeItem, sideProjectItem] }}
          planError={null}
          report={null}
          isPending={false}
          onConfirm={(skip) => { confirmedSkip = skip; }}
          projectType="portfolio"
        />,
      );
    });

    const worktreeCheckbox = findCheckbox('repo-a')!;
    await act(async () => { worktreeCheckbox.click(); });
    const confirmButton = Array.from(document.body.querySelectorAll('button'))
      .find((b) => b.textContent?.includes('Delete project'))!;
    await act(async () => { confirmButton.click(); });

    // Same items, same unchecked row, same expected payload as the
    // non-portfolio case above ('unchecking a row and confirming hands
    // onConfirm exactly that skip entry') — the portfolio block is purely
    // presentational and must not touch the skip mechanics.
    assert.deepEqual(confirmedSkip, [{ kind: 'worktree', label: 'repo-a' }]);
  } finally {
    await act(async () => { root.unmount(); });
  }
});
