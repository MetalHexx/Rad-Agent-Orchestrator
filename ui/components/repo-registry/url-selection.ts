import type { RailSelection } from './registry-rail';

export function parseRegistrySelection(params: { repo: string | null; group: string | null }): RailSelection | null {
  if (params.repo && params.repo.trim() !== '') return { kind: 'repo', slug: params.repo };
  if (params.group && params.group.trim() !== '') return { kind: 'group', slug: params.group };
  return null;
}

export function selectionToQuery(sel: RailSelection | null): string {
  if (sel === null) return '/repo-registry';
  return `/repo-registry?${sel.kind}=${encodeURIComponent(sel.slug)}`;
}
