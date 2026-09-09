import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const SRC = readFileSync(path.join(process.cwd(), 'app', 'projects', '[[...slug]]', 'page.tsx'), 'utf-8');

test('projects page mounts ArtifactLiveProvider (AD-8)', () => {
  assert.ok(SRC.includes('ArtifactLiveProvider'), 'provider imported and mounted');
  assert.ok(SRC.includes('useArtifactLive'), 'page reads the live store');
});

test('projects page mounts ApprovalWizardProvider ABOVE every live-state subtree', () => {
  // Placement is the fix, not a style choice. A successful final approval
  // completes the graph, so `resolveStateId` swaps the dag-widget card from
  // finalReviewView to completeView and unmounts the Approve button that
  // started it. The wizard has to outlive that, which it only does from
  // outside the live-state tree — hence: above the sidebar and the artifact
  // provider, not nested inside either.
  assert.ok(SRC.includes('ApprovalWizardProvider'), 'provider imported and mounted');
  const wizardAt = SRC.indexOf('<ApprovalWizardProvider>');
  const sidebarAt = SRC.indexOf('<SidebarProvider');
  const artifactAt = SRC.indexOf('<ArtifactLiveProvider');
  assert.ok(wizardAt >= 0, 'the provider is actually rendered, not just imported');
  assert.ok(wizardAt < sidebarAt, 'the wizard wraps the sidebar rather than sitting inside it');
  assert.ok(wizardAt < artifactAt, 'the wizard wraps the live artifact provider too');
});

test('the unseen clear is wired at the modal active-file choke point (AD-9, FR-9)', () => {
  assert.ok(SRC.includes('markActive'), 'markActive clear wire present');
  // The clear fires from the single active-artifact effect, not per surface.
  assert.ok(/markActive\(/.test(SRC), 'markActive is invoked');
});

test('the provider receives the modal active file name so the open doc shows no badge (DD-5)', () => {
  assert.ok(/activeFileName=/.test(SRC), 'active file name passed to the provider');
});

test('a confirmed delete corrects the open modal immediately (FR-9, AD-9)', () => {
  assert.ok(SRC.includes('registerOnDeleted'), 'inner registers its modal delete handler with the outer');
  assert.ok(SRC.includes('modal.onDeleted'), 'the modal index-correction handler is wired');
});

test("a confirmed delete also issues an immediate snapshot refresh via live.refresh(), not just the modal's own correction (P01-T01)", () => {
  const onDeletedIdx = SRC.indexOf('const onDeleted = React.useCallback');
  assert.ok(onDeletedIdx >= 0, 'the composed onDeleted handler is defined');
  const onDeletedLine = SRC.slice(onDeletedIdx, SRC.indexOf('\n', onDeletedIdx));
  assert.ok(onDeletedLine.includes('modal.onDeleted()'), 'the composed handler still runs the modal correction');
  assert.ok(onDeletedLine.includes('live.refresh()'), 'the composed handler also triggers an immediate provider refresh');
  assert.ok(SRC.includes('registerOnDeleted(onDeleted)'), 'the OUTER registration receives the composed handler, not the bare modal.onDeleted');
});
