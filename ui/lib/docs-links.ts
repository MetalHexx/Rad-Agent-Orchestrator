/**
 * Pure, browser-safe resolution of hrefs and image sources found inside the
 * rendered docs corpus. Imported by a `"use client"` component, so this file
 * must never import `node:*` — `path.posix` is not available in the browser
 * bundle and Next 14 will not polyfill it. The posix join/normalize this
 * needs is written out inline below instead.
 */

export type ResolvedDocLink =
  | { kind: 'internal'; href: string } // in-app route, may carry '#anchor'
  | { kind: 'anchor'; hash: string } // '#…' on the current page
  | { kind: 'asset'; href: string } // a corpus image, served by the asset route
  | { kind: 'external'; href: string }; // left alone, opens in a new tab

const SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z\d+\-.]*:/;

function dirnameOf(corpusPath: string): string {
  const idx = corpusPath.lastIndexOf('/');
  return idx === -1 ? '' : corpusPath.slice(0, idx);
}

function splitHash(value: string): { path: string; hash: string } {
  const idx = value.indexOf('#');
  return idx === -1 ? { path: value, hash: '' } : { path: value.slice(0, idx), hash: value.slice(idx) };
}

/**
 * Joins `relative` onto directory `dir`, collapsing `.` and `..` segments
 * (posix rules, written inline — see the file header for why). Returns null
 * when a `..` climbs above the corpus root.
 */
function resolveRelative(dir: string, relative: string): string | null {
  const stack = dir ? dir.split('/') : [];
  for (const segment of relative.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (stack.length === 0) return null;
      stack.pop();
    } else {
      stack.push(segment);
    }
  }
  return stack.join('/');
}

function assetRouteFor(corpusPath: string): string {
  return `/api/docs/asset?path=${encodeURIComponent(corpusPath)}`;
}

function stripMdExtension(corpusPath: string): string {
  return corpusPath.endsWith('.md') ? corpusPath.slice(0, -3) : corpusPath;
}

/**
 * 'README.md' → '/docs'; 'docs/pipeline.md' → '/docs/pipeline'.
 *
 * A `README.md` index is assumed to live only at the corpus root — the same
 * assumption `DocsView`'s root check makes. This direction would happily strip
 * a nested `docs/<section>/README.md` down to `/docs/<section>`, but
 * `routeToCorpusPath` cannot invert that (see there), so adding a nested index
 * means teaching both halves about it, not just this one.
 */
export function corpusPathToRoute(corpusPath: string): string {
  let rest = stripMdExtension(corpusPath);
  if (rest === 'docs') {
    rest = '';
  } else if (rest.startsWith('docs/')) {
    rest = rest.slice('docs/'.length);
  }
  if (rest === 'README') {
    rest = '';
  } else if (rest.endsWith('/README')) {
    rest = rest.slice(0, -'/README'.length);
  }
  return rest ? `/docs/${rest}` : '/docs';
}

/**
 * '/docs' → 'README.md'; '/docs/pipeline' → 'docs/pipeline.md'.
 *
 * Every non-root route maps to '<slug>.md'. With no directory listing to
 * consult it cannot tell a page from a folder holding a `README.md`, so a
 * nested index would resolve to the wrong corpus path and 404 on direct load
 * — hence the root-only-README constraint recorded on `corpusPathToRoute`.
 *
 * Takes the ENCODED pathname straight from usePathname() and owns the
 * decode: it decodes each segment exactly once, and a segment with a
 * malformed '%' is passed through rather than allowed to throw. The caller
 * must not pre-decode.
 */
export function routeToCorpusPath(pathname: string): string {
  const trimmed = pathname.replace(/^\/docs\/?/, '');
  if (trimmed === '') return 'README.md';
  const segments = trimmed
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
  return `docs/${segments.join('/')}.md`;
}

/** Resolve an href found on the page whose corpus path is `fromCorpusPath`. */
export function resolveDocHref(href: string, fromCorpusPath: string): ResolvedDocLink {
  if (href.startsWith('#')) {
    return { kind: 'anchor', hash: href };
  }
  if (SCHEME_PATTERN.test(href) || href.startsWith('//')) {
    return { kind: 'external', href };
  }
  if (href.startsWith('/')) {
    // Already an in-app absolute route — nothing left to resolve.
    return { kind: 'internal', href };
  }

  const { path: hrefPath, hash } = splitHash(href);
  const resolved = resolveRelative(dirnameOf(fromCorpusPath), hrefPath);
  if (resolved === null) {
    return { kind: 'external', href };
  }
  if (resolved.endsWith('.md')) {
    return { kind: 'internal', href: `${corpusPathToRoute(resolved)}${hash}` };
  }
  return { kind: 'asset', href: assetRouteFor(resolved) };
}

/** The asset-route URL for an <img src> found on that same page. */
export function resolveDocImageSrc(src: string, fromCorpusPath: string): string {
  if (SCHEME_PATTERN.test(src) || src.startsWith('//') || src.startsWith('/')) {
    return src;
  }
  const resolved = resolveRelative(dirnameOf(fromCorpusPath), src);
  return resolved === null ? src : assetRouteFor(resolved);
}
