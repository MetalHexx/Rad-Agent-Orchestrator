/**
 * Tests for components/layout/app-header — AppHeader component verification.
 * Run with: npx tsx --tsconfig ui/tsconfig.test.json ui/components/layout/app-header.test.tsx
 */
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import React from 'react';
import { AppHeader } from './app-header';
import * as barrel from './index';
import type { NavLink } from './app-header'; // Compile-time proof: NavLink is re-exported from the barrel

// React must be in scope for JSX evaluation within the module under test (loadAppHeaderWithMockedNav uses require cache manipulation)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;

// NavLink is a TypeScript interface; this import verifies it is exported from the module.
// The type is erased at runtime — its presence here is a compile-time check only.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _NavLinkCheck = NavLink;

// ─── Source text helper ───────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const sourceText = readFileSync(join(__dirname, 'app-header.tsx'), 'utf-8');

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

type ReactElementLike = {
  props?: {
    'aria-label'?: string;
    children?: unknown;
  };
};

function findByAriaLabel(element: unknown, label: string): ReactElementLike | null {
  if (element === null || element === undefined) return null;
  if (typeof element !== 'object') return null;
  const el = element as ReactElementLike;
  if (el.props?.['aria-label'] === label) return el;
  const children = el.props?.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      const found = findByAriaLabel(child, label);
      if (found) return found;
    }
  } else if (children !== null && children !== undefined) {
    return findByAriaLabel(children, label);
  }
  return null;
}

function findByAriaLabelPrefix(element: unknown, prefix: string): ReactElementLike | null {
  if (element === null || element === undefined) return null;
  if (typeof element !== 'object') return null;
  const el = element as ReactElementLike;
  const ariaLabel = el.props?.['aria-label'];
  if (typeof ariaLabel === 'string' && ariaLabel.startsWith(prefix)) return el;
  const children = el.props?.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      const found = findByAriaLabelPrefix(child, prefix);
      if (found) return found;
    }
  } else if (children !== null && children !== undefined) {
    return findByAriaLabelPrefix(children, prefix);
  }
  return null;
}

type NavLinkElement = {
  props?: {
    href?: string;
    'aria-current'?: string;
    children?: unknown;
  };
};

function findByHref(element: unknown, href: string): NavLinkElement | null {
  if (element === null || element === undefined) return null;
  if (typeof element !== 'object') return null;
  const el = element as NavLinkElement;
  if (el.props?.href === href) return el;
  const children = el.props?.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      const found = findByHref(child, href);
      if (found) return found;
    }
  } else if (children !== null && children !== undefined) {
    return findByHref(children, href);
  }
  return null;
}

/**
 * Load a fresh AppHeader with next/navigation's usePathname mocked to '/' so
 * the component can be called as a plain function (no React renderer needed).
 * tsx compiles imports to CJS require(), so require.cache is accessible.
 */
function loadAppHeaderWithMockedNav(pathname = '/'): typeof AppHeader {
  const req = require as NodeRequire & { cache: Record<string, { exports: unknown }> };
  const navPath = req.resolve('next/navigation');
  const headerPath = req.resolve('./app-header');
  const origNavExports = req.cache[navPath]?.exports;
  assert.ok(origNavExports, 'next/navigation must be in require cache before mock');

  // Replace next/navigation exports so the re-loaded app-header gets the mock.
  const mock = Object.create(origNavExports as object) as Record<string, unknown>;
  Object.defineProperty(mock, 'usePathname', {
    value: () => pathname,
    writable: true,
    enumerable: true,
    configurable: true,
  });
  req.cache[navPath].exports = mock;
  delete req.cache[headerPath];
  try {
    const fresh = req('./app-header') as { AppHeader: typeof AppHeader };
    return fresh.AppHeader;
  } finally {
    req.cache[navPath].exports = origNavExports;
  }
}

async function run() {
  console.log('app-header — exports and structure');

  await test('AppHeader is exported and is a function', () => {
    assert.strictEqual(typeof AppHeader, 'function');
  });

  await test('AppHeader is re-exported from the barrel', () => {
    assert.strictEqual(typeof barrel.AppHeader, 'function');
  });

  await test('AppHeader.name equals "AppHeader"', () => {
    assert.strictEqual(AppHeader.name, 'AppHeader');
  });

  await test('NavLink with matching pathname has aria-current="page", non-matching has aria-current={undefined}', () => {
    const AppHeaderMocked = loadAppHeaderWithMockedNav();
    const navLinks = [{ label: 'Home', href: '/' }, { label: 'Projects', href: '/projects' }];
    const tree = AppHeaderMocked({ sseStatus: 'connected', onReconnect: () => {}, onConfigClick: () => {}, navLinks });
    const homeLink = findByHref(tree, '/');
    const projectsLink = findByHref(tree, '/projects');
    assert.notStrictEqual(homeLink, null, 'Expected to find link with href="/"');
    assert.notStrictEqual(projectsLink, null, 'Expected to find link with href="/projects"');
    assert.strictEqual(homeLink!.props?.['aria-current'], 'page', 'Link href="/" should have aria-current="page"');
    assert.strictEqual(projectsLink!.props?.['aria-current'], undefined, 'Link href="/projects" should have aria-current={undefined}');
  });

  await test('Settings button hidden when onConfigClick is undefined', () => {
    const AppHeaderMocked = loadAppHeaderWithMockedNav();
    const tree = AppHeaderMocked({ sseStatus: 'connected', onReconnect: () => {}, onConfigClick: undefined, navLinks: [] });
    const found = findByAriaLabel(tree, 'Configuration');
    assert.strictEqual(found, null, 'Expected no Configuration button when onConfigClick is undefined');
  });

  await test('Settings button visible when onConfigClick is defined', () => {
    const AppHeaderMocked = loadAppHeaderWithMockedNav();
    const tree = AppHeaderMocked({ sseStatus: 'connected', onReconnect: () => {}, onConfigClick: () => {}, navLinks: [] });
    const found = findByAriaLabel(tree, 'Configuration');
    assert.notStrictEqual(found, null, 'Expected Configuration button to be present when onConfigClick is defined');
  });

  await test('ConnectionIndicator is imported', () => {
    assert.ok(
      sourceText.includes('import { ConnectionIndicator }') ||
        sourceText.includes('ConnectionIndicator'),
      'app-header.tsx must import ConnectionIndicator'
    );
  });

  await test('ThemeToggle is imported', () => {
    assert.ok(
      sourceText.includes('import { ThemeToggle }') ||
        sourceText.includes('ThemeToggle'),
      'app-header.tsx must import ThemeToggle'
    );
  });

  await test('ConnectionIndicator is rendered in source', () => {
    assert.ok(
      sourceText.includes('<ConnectionIndicator'),
      'app-header.tsx must render <ConnectionIndicator'
    );
  });

  await test('ThemeToggle is rendered in source', () => {
    assert.ok(
      sourceText.includes('<ThemeToggle'),
      'app-header.tsx must render <ThemeToggle'
    );
  });

  await test('Main navigation aria-label is present', () => {
    assert.ok(
      sourceText.includes('aria-label="Main navigation"'),
      'app-header.tsx must contain aria-label="Main navigation"'
    );
  });

  await test('Dashboard controls aria-label is present', () => {
    assert.ok(
      sourceText.includes('aria-label="Dashboard controls"'),
      'app-header.tsx must contain aria-label="Dashboard controls"'
    );
  });

  await test('version prop renders v{version} text with correct aria-label', () => {
    const AppHeaderMocked = loadAppHeaderWithMockedNav();
    const tree = AppHeaderMocked({
      sseStatus: 'connected',
      onReconnect: () => {},
      onConfigClick: () => {},
      navLinks: [],
      version: '1.2.3-test',
    });
    const versionEl = findByAriaLabel(tree, 'Version 1.2.3-test');
    assert.notStrictEqual(versionEl, null, 'Expected a span with aria-label="Version 1.2.3-test"');
    const children = versionEl!.props?.children;
    const text = Array.isArray(children) ? children.join('') : String(children);
    assert.strictEqual(text, 'v1.2.3-test', `Expected version text "v1.2.3-test", got "${text}"`);
  });

  await test('version prop absent — no version span rendered', () => {
    const AppHeaderMocked = loadAppHeaderWithMockedNav();
    const tree = AppHeaderMocked({
      sseStatus: 'connected',
      onReconnect: () => {},
      onConfigClick: () => {},
      navLinks: [],
    });
    const versionEl = findByAriaLabelPrefix(tree, 'Version ');
    assert.strictEqual(versionEl, null, 'Expected no version span when version prop is absent');
  });

  await test('version span uses muted-foreground/60 class in source', () => {
    assert.ok(
      sourceText.includes('text-muted-foreground/60'),
      'app-header.tsx must style the version span with text-muted-foreground/60'
    );
  });

  await test('Projects tab stays highlighted on a deep project URL (prefix match)', () => {
    const AppHeaderMocked = loadAppHeaderWithMockedNav('/projects/DEMO');
    const navLinks = [{ label: 'Home', href: '/' }, { label: 'Projects', href: '/projects' }];
    const tree = AppHeaderMocked({ sseStatus: 'connected', onReconnect: () => {}, onConfigClick: () => {}, navLinks });
    const projectsLink = findByHref(tree, '/projects');
    assert.notStrictEqual(projectsLink, null, 'Expected to find link with href="/projects"');
    assert.strictEqual(projectsLink!.props?.['aria-current'], 'page', 'deep project URL keeps the Projects tab active');
  });

  await test('Docs control is present, labeled for a screen reader, and links to /docs', () => {
    const AppHeaderMocked = loadAppHeaderWithMockedNav();
    const tree = AppHeaderMocked({ sseStatus: 'connected', onReconnect: () => {}, onConfigClick: () => {}, navLinks: [] });
    const docsButton = findByAriaLabel(tree, 'Docs') as
      | { props?: { render?: { props?: { href?: string } } } }
      | null;
    assert.notStrictEqual(docsButton, null, 'Expected a control labeled "Docs" in the header');
    const rendered = docsButton!.props?.render;
    assert.ok(rendered, 'Docs control must compose a next/link via the render prop (this Button has no asChild)');
    assert.strictEqual(rendered!.props?.href, '/docs', 'Docs control must link to /docs');
  });

  await test('Docs control renders unconditionally, unlike Configuration', () => {
    const AppHeaderMocked = loadAppHeaderWithMockedNav();
    const tree = AppHeaderMocked({ sseStatus: 'connected', onReconnect: () => {}, onConfigClick: undefined, navLinks: [] });
    const docsButton = findByAriaLabel(tree, 'Docs');
    assert.notStrictEqual(docsButton, null, 'Docs control must render even when onConfigClick is undefined');
  });

  await test('Docs control appears immediately before the Configuration button in source', () => {
    const docsIdx = sourceText.indexOf('aria-label="Docs"');
    const configIdx = sourceText.indexOf('aria-label="Configuration"');
    assert.ok(docsIdx > 0 && configIdx > docsIdx, 'Docs control must appear before the Configuration button');
  });

  await test('nav links include Instruction Editor between Process Editor and Config (DD-12)', async () => {
    const shellSource = readFileSync(join(__dirname, 'app-header-shell.tsx'), 'utf-8');
    const peIdx = shellSource.indexOf('"Process Editor"');
    const ieIdx = shellSource.indexOf('"Instruction Editor"');
    assert.ok(peIdx > 0 && ieIdx > peIdx, 'Instruction Editor must appear after Process Editor');
    assert.match(shellSource, /\{\s*label:\s*"Instruction Editor",\s*href:\s*"\/action-events"\s*\}/);
  });

  if (failed > 0) {
    console.error(`\n${failed} test(s) failed, ${passed} passed`);
    process.exit(1);
  } else {
    console.log(`\nAll ${passed} tests passed`);
  }
}

run();
