import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ObservabilityUsageRow } from '@rad-orchestration/telemetry';
import { dollarsFor } from '@rad-orchestration/telemetry/read/pricing';
import { effectiveTokens } from './effective-tokens';
import { sumRawTokens } from './raw-tokens';
import { formatUsd, spendReceipt } from './spend-display';

function row(partial: Partial<ObservabilityUsageRow> & { model: string }): ObservabilityUsageRow {
  return {
    sessionId: 's', usageId: `u-${Math.random()}`, timestamp: '2026-07-01T00:00:00.000Z',
    inputTokens: 0, outputTokens: 0, source: 'main-agent', harness: 'claude-code',
    ...partial,
  } as ObservabilityUsageRow;
}

test('computes newTokens, costWeighted, and raw from the row set (FR-4, FR-6)', () => {
  const rows = [
    row({ model: 'claude-opus-4-8', inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, cacheCreationTokens: 40 }),
    row({ model: 'claude-haiku-4-5', inputTokens: 20, outputTokens: 5, cacheCreationTokens: 60 }),
  ];
  const receipt = spendReceipt(rows);
  assert.equal(receipt.newTokens, 40 + 60, 'sums cacheCreationTokens across rows');
  assert.equal(receipt.costWeighted, rows.reduce((sum, r) => sum + effectiveTokens(r), 0), 'delegates to effectiveTokens');
  assert.deepEqual(receipt.raw, sumRawTokens(rows), 'delegates to sumRawTokens');
});

test('per-model dollar attribution sums within a model, not blended across models', () => {
  const opusRow1 = row({ model: 'claude-opus-4-8', inputTokens: 1_000_000, outputTokens: 200_000 });
  const opusRow2 = row({ model: 'claude-opus-4-8', inputTokens: 500_000, outputTokens: 100_000 });
  const haikuRow = row({ model: 'claude-haiku-4-5', inputTokens: 1_000_000, outputTokens: 200_000 });
  const receipt = spendReceipt([opusRow1, opusRow2, haikuRow]);

  const expectedOpus = dollarsFor(opusRow1)! + dollarsFor(opusRow2)!;
  const expectedHaiku = dollarsFor(haikuRow)!;

  const opusEntry = receipt.perModel.find((p) => p.model === 'claude-opus-4-8');
  const haikuEntry = receipt.perModel.find((p) => p.model === 'claude-haiku-4-5');
  assert.equal(opusEntry?.dollars, expectedOpus, 'opus rows summed together, not per-row');
  assert.equal(haikuEntry?.dollars, expectedHaiku);
  assert.equal(receipt.dollars, expectedOpus + expectedHaiku, 'total is the sum across models');
  assert.ok(
    receipt.perModel.findIndex((p) => p.model === 'claude-opus-4-8')
      < receipt.perModel.findIndex((p) => p.model === 'claude-haiku-4-5'),
    'sorted desc by dollars',
  );
});

test('an unknown-priced model makes the total unavailable without dropping known models (never a silent $0)', () => {
  const haikuRow = row({ model: 'claude-haiku-4-5', inputTokens: 1_000_000, outputTokens: 200_000 });
  const unknownRow = row({ model: 'gpt-5-codex', inputTokens: 1_000, outputTokens: 1_000 });
  const receipt = spendReceipt([haikuRow, unknownRow]);

  assert.equal(receipt.dollars, null, 'total is unavailable, not a partial sum');
  const unknownEntry = receipt.perModel.find((p) => p.model === 'gpt-5-codex');
  assert.equal(unknownEntry?.dollars, null, 'the unknown model itself is unavailable');
  const haikuEntry = receipt.perModel.find((p) => p.model === 'claude-haiku-4-5');
  assert.equal(haikuEntry?.dollars, dollarsFor(haikuRow), 'the known model still carries its own dollar figure');
});

test('formatUsd renders the unavailable state for null and a clean dollar string for a value', () => {
  assert.equal(formatUsd(null), 'price unavailable');
  assert.notEqual(formatUsd(null), '$0');
  assert.equal(formatUsd(9.427), '$9.43');
});
