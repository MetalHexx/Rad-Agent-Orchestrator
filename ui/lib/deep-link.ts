/**
 * Build a deep link to a project document, addressed by its full
 * project-relative path. Each path segment is encoded independently and
 * rejoined with `/` — real path segments, not a single `%2F`-encoded segment
 * — so a nested path (`phases/PHASE-2-PLAN.md`) round-trips through the
 * `[[...slug]]` catch-all route without depending on `usePathname()`
 * preserving an un-normalized `%2F`.
 */
export function buildDocDeepLink(origin: string, projectName: string, docPath: string): string {
  const encodedPath = docPath.split('/').map(encodeURIComponent).join('/');
  return `${origin}/projects/${encodeURIComponent(projectName)}/docs/${encodedPath}`;
}
