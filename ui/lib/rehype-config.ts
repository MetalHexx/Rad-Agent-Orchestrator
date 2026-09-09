import type { PluggableList } from 'unified';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';

/**
 * Custom sanitize schema that extends the default to allow
 * `language-*` classes on `code` elements (required for shiki
 * to detect code block languages).
 */
export const customSanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [
      ...(defaultSchema.attributes?.code || []),
      ['className', /^language-./],
    ],
  },
};

/**
 * Returns the ordered rehype plugin array for react-markdown.
 * Single source of truth for plugin ordering:
 *   1. rehype-raw (opt-in — parses raw HTML back into the tree)
 *   2. rehype-sanitize (with custom schema)
 *   3. rehype-slug (heading IDs)
 *   4. rehype-autolink-headings (anchor links)
 *
 * `rehype-raw` must run before `rehype-sanitize`: sanitizing first would find
 * only an unparsed raw text node and have nothing to strip. It defaults off —
 * every caller except the docs viewer gets the same plugin list as before
 * `rawHtml` existed, so raw HTML stays inert everywhere else (e.g. transcript
 * tool-output rendering, which must never parse arbitrary file contents as
 * markup).
 */
export function getRehypePlugins(options?: { rawHtml?: boolean }): PluggableList {
  return [
    ...(options?.rawHtml ? [rehypeRaw] : []),
    [rehypeSanitize, customSanitizeSchema],
    rehypeSlug,
    rehypeAutolinkHeadings,
  ];
}
