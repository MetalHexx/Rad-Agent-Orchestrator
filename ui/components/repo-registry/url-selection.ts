import type { RailSelection } from './registry-rail';

export function parseRegistrySelection(params: { repo: string | null; group: string | null }): RailSelection | null {
  // Return the trimmed value as the slug — testing `.trim()` for emptiness but
  // keeping the untrimmed value would leak leading/trailing spaces into lookups.
  const repo = params.repo?.trim();
  if (repo) return { kind: 'repo', slug: repo };
  const group = params.group?.trim();
  if (group) return { kind: 'group', slug: group };
  return null;
}

export function selectionToQuery(sel: RailSelection | null): string {
  if (sel === null) return '/repo-registry';
  return `/repo-registry?${sel.kind}=${encodeURIComponent(sel.slug)}`;
}
