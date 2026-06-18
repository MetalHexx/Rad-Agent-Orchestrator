/**
 * Tests for components/layout/app-header-shell — AppHeaderShell component verification.
 * Run with: npx tsx --tsconfig ui/tsconfig.test.json ui/components/layout/app-header-shell.test.tsx
 */
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { AppHeaderShell } from './app-header-shell';
import * as barrel from './index';

// ─── Source text helper ───────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const sourceText = readFileSync(join(__dirname, 'app-header-shell.tsx'), 'utf-8');

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`  ✗ ${name}\n    ${msg}`);
    failed++;
  }
}

async function run() {
  console.log('app-header-shell — exports and structure');

  await test('AppHeaderShell is exported and is a function', () => {
    assert.strictEqual(typeof AppHeaderShell, 'function');
  });

  await test('AppHeaderShell is re-exported from the barrel', () => {
    assert.strictEqual(typeof barrel.AppHeaderShell, 'function');
  });

  await test('AppHeaderShell.name equals "AppHeaderShell"', () => {
    assert.strictEqual(AppHeaderShell.name, 'AppHeaderShell');
  });

  await test('NAV_LINKS contains "/projects" href', () => {
    assert.ok(
      sourceText.includes('"/projects"') || sourceText.includes("'/projects'"),
      'app-header-shell.tsx must contain a NAV_LINKS entry with href="/projects"'
    );
  });

  await test('NAV_LINKS does NOT contain "/projects-v4" href (hidden from nav)', () => {
    assert.ok(
      !sourceText.includes('"/projects-v4"') && !sourceText.includes("'/projects-v4'"),
      'app-header-shell.tsx must NOT contain a NAV_LINKS entry with href="/projects-v4" — v4 is hidden from the header'
    );
  });

  await test('SSEProvider is imported', () => {
    assert.ok(
      sourceText.includes('import { SSEProvider') || sourceText.includes('import {SSEProvider'),
      'app-header-shell.tsx must import SSEProvider'
    );
  });

  await test('ConfigClickProvider is imported', () => {
    assert.ok(
      sourceText.includes('import { ConfigClickProvider') ||
        sourceText.includes('import {ConfigClickProvider') ||
        sourceText.includes('useConfigClickContext'),
      'app-header-shell.tsx must import ConfigClickProvider or useConfigClickContext'
    );
  });

  await test('AppHeaderShell wraps children in SSEProvider', () => {
    assert.ok(
      sourceText.includes('<SSEProvider>'),
      'app-header-shell.tsx must render <SSEProvider>'
    );
  });

  await test('AppHeaderShell wraps children in ConfigClickProvider', () => {
    assert.ok(
      sourceText.includes('<ConfigClickProvider>'),
      'app-header-shell.tsx must render <ConfigClickProvider>'
    );
  });

  await test('sseStatus is passed to AppHeader', () => {
    assert.ok(
      sourceText.includes('sseStatus={sseStatus}') || sourceText.includes('sseStatus='),
      'app-header-shell.tsx must pass sseStatus to AppHeader'
    );
  });

  await test('reconnect is passed to AppHeader', () => {
    assert.ok(
      sourceText.includes('onReconnect={reconnect}'),
      'app-header-shell.tsx must pass reconnect to AppHeader'
    );
  });

  await test('NAV_LINKS adds Observability before Brainstorm POC (FR-1)', () => {
    const obs = sourceText.indexOf('/observability');
    const poc = sourceText.indexOf('/brainstorm-poc');
    assert.ok(obs !== -1, 'app-header-shell.tsx must contain an Observability nav entry (href="/observability")');
    assert.ok(poc !== -1, 'Brainstorm POC nav entry must still exist');
    assert.ok(obs < poc, 'Observability must be ordered before Brainstorm POC in NAV_LINKS');
  });

  if (failed > 0) {
    console.error(`\n${failed} test(s) failed, ${passed} passed`);
    process.exit(1);
  } else {
    console.log(`\nAll ${passed} tests passed`);
  }
}

run();
