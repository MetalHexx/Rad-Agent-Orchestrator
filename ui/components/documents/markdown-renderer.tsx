"use client";

import React, { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Link from "next/link";
import { getRehypePlugins } from "@/lib/rehype-config";
import { resolveDocHref, resolveDocImageSrc } from "@/lib/docs-links";
import { cn } from "@/lib/utils";
import { Hash } from "lucide-react";
import { MermaidBlock } from "./mermaid-block";
import { SyntaxHighlighter } from "./syntax-highlighter";
import type { Components } from "react-markdown";

interface MarkdownRendererProps {
  /** Markdown content string (frontmatter already stripped) */
  content: string;
  /** Docs-viewer mode. Omitted for project documents — their rendering is unchanged. */
  docs?: { corpusPath: string };
}

/**
 * Recursively extract all text content from a React element tree.
 */
function extractText(node: React.ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (!node) return "";
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (React.isValidElement(node)) {
    const { children } = node.props as { children?: React.ReactNode };
    return extractText(children);
  }
  return "";
}

interface HeadingAnchorProps {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  id?: string;
  children?: React.ReactNode;
  /**
   * Docs-mode click handling: scroll without requiring a ScrollArea ancestor
   * and write the hash to the URL as a history entry. Omitted for project
   * documents, whose anchors keep the drawer's original behavior (scroll the
   * ScrollArea viewport, no URL write) byte-for-byte.
   */
  onAnchorClick?: (id: string) => void;
}

function HeadingAnchor({ level, id, children, onAnchorClick, ...props }: HeadingAnchorProps & Record<string, unknown>) {
  const Tag = `h${level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
  return (
    <Tag className="group" id={id} {...props}>
      {children}
      {id && (
        <a
          href={`#${id}`}
          aria-label={`Link to section: ${extractText(children)}`}
          className="inline-flex items-center ml-1 text-muted-foreground opacity-0 group-hover:opacity-70 transition-opacity focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded"
          onClick={(event) => {
            event.preventDefault();
            if (onAnchorClick) {
              onAnchorClick(id);
              return;
            }
            const target = document.getElementById(id);
            if (!target) return;
            const viewport = target.closest('[data-slot="scroll-area-viewport"]');
            if (!viewport) return;
            const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            const targetTop = target.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop;
            viewport.scrollTo({ top: targetTop - 16, behavior: prefersReducedMotion ? 'instant' : 'smooth' });
          }}
        >
          <Hash size={level <= 2 ? 18 : 14} aria-hidden="true" />
        </a>
      )}
    </Tag>
  );
}

/** Scrolls to `id` (window-level — no ScrollArea ancestor required) and
 *  writes '#id' to the URL as a real history entry, matching this repo's
 *  shallow-navigation convention (window.history.pushState, not router.push,
 *  so the docs page doesn't remount). */
function scrollToHeadingAndWriteHash(id: string): void {
  const target = document.getElementById(id);
  if (target) {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ behavior: prefersReducedMotion ? 'instant' : 'smooth', block: 'start' });
  }
  window.history.pushState(null, '', `#${id}`);
}

const components: Components = {
  h1({ children, id, ...props }) {
    return <HeadingAnchor level={1} id={id} {...props}>{children}</HeadingAnchor>;
  },
  h2({ children, id, ...props }) {
    return <HeadingAnchor level={2} id={id} {...props}>{children}</HeadingAnchor>;
  },
  h3({ children, id, ...props }) {
    return <HeadingAnchor level={3} id={id} {...props}>{children}</HeadingAnchor>;
  },
  h4({ children, id, ...props }) {
    return <HeadingAnchor level={4} id={id} {...props}>{children}</HeadingAnchor>;
  },
  h5({ children, id, ...props }) {
    return <HeadingAnchor level={5} id={id} {...props}>{children}</HeadingAnchor>;
  },
  h6({ children, id, ...props }) {
    return <HeadingAnchor level={6} id={id} {...props}>{children}</HeadingAnchor>;
  },
  pre({ children }) {
    return <>{children}</>;
  },
  code({ children, className, ...props }) {
    const text = extractText(children);
    const isInline = !className && !text.includes('\n');
    if (isInline) {
      return (
        <code
          className="bg-muted px-1.5 py-0.5 rounded text-sm"
          {...props}
        >
          {children}
        </code>
      );
    }
    // Mermaid detection — render diagram instead of code block
    if (className?.includes('language-mermaid')) {
      return <MermaidBlock code={text} />;
    }
    const lang = (className?.replace('language-', '') ?? 'text').trim() || 'text';
    return <SyntaxHighlighter code={text} lang={lang} />;
  },
  table({ children, ...props }) {
    return (
      <div className="overflow-x-auto">
        <table {...props}>{children}</table>
      </div>
    );
  },
  input({ type, checked, ...props }) {
    if (type === "checkbox") {
      return (
        <input
          type="checkbox"
          checked={checked}
          disabled
          className="mr-1.5 align-middle"
          {...props}
        />
      );
    }
    return <input type={type} checked={checked} {...props} />;
  },
};

/**
 * Docs-viewer components: same headings/pre/code/table/input as the default
 * set (`pre`/`code`/`table`/`input` are inherited unchanged via spread), plus
 * doc-aware `h1`-`h6`/`a`/`img` overrides that resolve corpus-relative links
 * and images through `docs-links.ts`. Built per-render (memoized on
 * `corpusPath`) because the overrides close over it — project documents
 * never pay for this, they keep using the module-level constant.
 */
function buildDocsComponents(corpusPath: string): Components {
  return {
    ...components,
    h1({ children, id, ...props }) {
      return <HeadingAnchor level={1} id={id} onAnchorClick={scrollToHeadingAndWriteHash} {...props}>{children}</HeadingAnchor>;
    },
    h2({ children, id, ...props }) {
      return <HeadingAnchor level={2} id={id} onAnchorClick={scrollToHeadingAndWriteHash} {...props}>{children}</HeadingAnchor>;
    },
    h3({ children, id, ...props }) {
      return <HeadingAnchor level={3} id={id} onAnchorClick={scrollToHeadingAndWriteHash} {...props}>{children}</HeadingAnchor>;
    },
    h4({ children, id, ...props }) {
      return <HeadingAnchor level={4} id={id} onAnchorClick={scrollToHeadingAndWriteHash} {...props}>{children}</HeadingAnchor>;
    },
    h5({ children, id, ...props }) {
      return <HeadingAnchor level={5} id={id} onAnchorClick={scrollToHeadingAndWriteHash} {...props}>{children}</HeadingAnchor>;
    },
    h6({ children, id, ...props }) {
      return <HeadingAnchor level={6} id={id} onAnchorClick={scrollToHeadingAndWriteHash} {...props}>{children}</HeadingAnchor>;
    },
    a({ href, children, ...props }) {
      if (!href) {
        return <a {...props}>{children}</a>;
      }
      const resolved = resolveDocHref(href, corpusPath);
      switch (resolved.kind) {
        case 'internal':
          return (
            <Link href={resolved.href} {...props}>
              {children}
            </Link>
          );
        case 'anchor':
          return (
            <a
              href={resolved.hash}
              {...props}
              onClick={(event) => {
                event.preventDefault();
                scrollToHeadingAndWriteHash(resolved.hash.slice(1));
              }}
            >
              {children}
            </a>
          );
        case 'asset':
        case 'external':
          return (
            <a href={resolved.href} target="_blank" rel="noopener noreferrer" {...props}>
              {children}
            </a>
          );
      }
    },
    img({ src, ...props }) {
      if (!src) {
        return <img src={src} {...props} />;
      }
      return <img src={resolveDocImageSrc(src, corpusPath)} {...props} />;
    },
  };
}

export function MarkdownRenderer({ content, docs }: MarkdownRendererProps) {
  const resolvedComponents = useMemo(
    () => (docs ? buildDocsComponents(docs.corpusPath) : components),
    [docs?.corpusPath],
  );

  return (
    <div className={cn("prose prose-sm dark:prose-invert max-w-none", docs && "docs-prose")}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={getRehypePlugins(docs ? { rawHtml: true } : undefined)}
        components={resolvedComponents}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
