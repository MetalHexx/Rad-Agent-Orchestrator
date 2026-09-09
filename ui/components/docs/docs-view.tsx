"use client";

import * as React from "react";
import { MarkdownRenderer } from "@/components/documents";

export interface DocsViewProps {
  /** Corpus-relative path of the page currently on screen (e.g. 'docs/pipeline.md'). */
  corpusPath: string;
  /** The fetched markdown body, or null while the initial fetch is in flight. */
  content: string | null;
}

/**
 * Scrolls the heading named by the URL's current fragment into view. A hash
 * naming nothing — or no hash at all — is a no-op; the page still renders in
 * full and whatever scroll position it already had is left alone.
 */
function scrollToAddressedHeading(): void {
  const hash = window.location.hash;
  if (!hash || hash.length < 2) return;
  const target = document.getElementById(hash.slice(1));
  if (!target) return;
  target.scrollIntoView({ block: "start" });
}

/**
 * The docs page shell: full-width, no project-list sidebar — a top-level page
 * in the same family as Observability, not a project view. Always renders
 * `<main id="main-content">` so the root layout's skip-to-content link never
 * dead-ends, even before the fetch resolves.
 */
export function DocsView({ corpusPath, content }: DocsViewProps) {
  // Deep-link scroll: the browser's native fragment scroll fires before the
  // markdown exists, so this runs in an effect keyed on `content` (not on
  // mount) once the doc body is actually in the DOM.
  React.useEffect(() => {
    if (content === null) return;
    scrollToAddressedHeading();
  }, [content]);

  // Back/forward between two anchors on the same page moves only the fragment:
  // the route never changes, so `content` never changes and the effect above
  // cannot see it. Heading anchors and in-doc '#' links push real history
  // entries of their own (MarkdownRenderer's docs mode), so without this the
  // address bar would reverse while the page stayed put.
  React.useEffect(() => {
    window.addEventListener("hashchange", scrollToAddressedHeading);
    return () => window.removeEventListener("hashchange", scrollToAddressedHeading);
  }, []);

  return (
    <main id="main-content" className="h-[calc(100vh-3.5rem)] overflow-y-auto px-10 py-7">
      {content !== null && (
        <div className="mx-auto max-w-[1040px] rounded-lg border border-border p-8">
          <MarkdownRenderer content={content} docs={{ corpusPath }} />
        </div>
      )}
    </main>
  );
}
