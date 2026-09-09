"use client";

import * as React from "react";
import { usePathname, notFound } from "next/navigation";
import { DocsView } from "@/components/docs";
import { routeToCorpusPath } from "@/lib/docs-links";

interface DocsContentResponse {
  frontmatter: Record<string, unknown>;
  content: string;
  filePath: string;
}

/**
 * Optional catch-all: `/docs`, `/docs/<page>`, and a future `/docs/<dir>/<page>`
 * all land here. Reads the route from `usePathname()` (ENCODED) rather than
 * `useParams()` for the same reason `app/projects/[[...slug]]/page.tsx` does —
 * and, unlike that page, does not decode it: `routeToCorpusPath` owns the
 * decode and the malformed-'%' guard, so decoding here too would double-decode.
 */
export default function DocsPage() {
  const pathname = usePathname();
  const corpusPath = routeToCorpusPath(pathname);
  const [content, setContent] = React.useState<string | null>(null);
  const [missing, setMissing] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    setContent(null);
    setMissing(false);

    fetch(`/api/docs/content?path=${encodeURIComponent(corpusPath)}`)
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 400 || res.status === 404) {
          // 404 is a corpus-absent page; 400 is a malformed/invalid corpus
          // path from routeToCorpusPath. Both mean "no page to show" — record
          // it in state and throw on the next render pass below, not here,
          // since notFound() thrown inside a promise callback lands where no
          // error boundary catches it.
          setMissing(true);
          return;
        }
        if (!res.ok) return;
        const data = (await res.json()) as DocsContentResponse;
        if (!cancelled) setContent(data.content);
      })
      .catch(() => {
        // Network failure: leave the shell rendered with no content rather
        // than misreport it as a missing corpus page.
      });

    return () => {
      cancelled = true;
    };
  }, [corpusPath]);

  if (missing) {
    notFound();
  }

  return <DocsView corpusPath={corpusPath} content={content} />;
}
