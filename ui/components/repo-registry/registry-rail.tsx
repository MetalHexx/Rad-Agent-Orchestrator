"use client";

import { Layers, Plus } from 'lucide-react';
import { BindStateDot } from './bind-state-dot';
import type { RailSections } from './rail-grouping';

export type RailSelection =
  | { kind: 'repo'; slug: string }
  | { kind: 'group'; slug: string };

interface Props {
  sections: RailSections;
  selected: RailSelection | null;
  onSelect: (kind: 'repo' | 'group', slug: string) => void;
  onAddRepo: () => void;
  onAddGroup: () => void;
}

function isSelected(selected: RailSelection | null, kind: 'repo' | 'group', slug: string): boolean {
  return selected !== null && selected.kind === kind && selected.slug === slug;
}

export function RegistryRail({ sections, selected, onSelect, onAddRepo, onAddGroup }: Props) {
  return (
    <aside
      className="flex shrink-0 flex-col overflow-y-auto border-r bg-[var(--sidebar-bg)]"
      style={{ width: 'var(--sidebar-width)' }}
    >
      {/* Repos head */}
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Repos
        </span>
        <button
          type="button"
          aria-label="Add Repo"
          onClick={onAddRepo}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          <Plus className="size-3" aria-hidden="true" />
          Add Repo
        </button>
      </div>

      {/* One labelled section per group */}
      {sections.repoSections.map(section => (
        <div key={section.group}>
          <div className="px-3 py-1">
            <span className="text-xs font-medium text-muted-foreground">{section.group}</span>
          </div>
          {section.repos.map(repo => (
            <button
              key={repo.slug}
              type="button"
              data-rail-key={`repo:${repo.slug}`}
              onClick={() => onSelect('repo', repo.slug)}
              className={[
                'flex w-full items-center gap-2 px-4 py-1.5 text-left text-sm font-mono',
                isSelected(selected, 'repo', repo.slug)
                  ? 'bg-accent text-accent-foreground font-semibold'
                  : 'text-foreground hover:bg-accent/50',
              ].join(' ')}
            >
              <BindStateDot state={repo.bind.state} />
              <span className="truncate">{repo.slug}</span>
            </button>
          ))}
        </div>
      ))}

      {/* Ungrouped section */}
      {sections.ungrouped.length > 0 && (
        <div>
          <div className="px-3 py-1">
            <span className="text-xs font-medium text-muted-foreground">Ungrouped</span>
          </div>
          {sections.ungrouped.map(repo => (
            <button
              key={repo.slug}
              type="button"
              data-rail-key={`repo:${repo.slug}`}
              onClick={() => onSelect('repo', repo.slug)}
              className={[
                'flex w-full items-center gap-2 px-4 py-1.5 text-left text-sm font-mono',
                isSelected(selected, 'repo', repo.slug)
                  ? 'bg-accent text-accent-foreground font-semibold'
                  : 'text-foreground hover:bg-accent/50',
              ].join(' ')}
            >
              <BindStateDot state={repo.bind.state} />
              <span className="truncate">{repo.slug}</span>
            </button>
          ))}
        </div>
      )}

      {/* Divider */}
      <div className="my-2 border-t" />

      {/* Repo Groups head */}
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Repo Groups
        </span>
        <button
          type="button"
          aria-label="Add Repo Group"
          onClick={onAddGroup}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          <Plus className="size-3" aria-hidden="true" />
          Add Repo Group
        </button>
      </div>

      {/* Group rows */}
      {sections.groups.map(group => (
        <button
          key={group.slug}
          type="button"
          data-rail-key={`group:${group.slug}`}
          onClick={() => onSelect('group', group.slug)}
          className={[
            'flex w-full items-center gap-2 px-4 py-1.5 text-left text-sm font-mono',
            isSelected(selected, 'group', group.slug)
              ? 'bg-accent text-accent-foreground font-semibold'
              : 'text-foreground hover:bg-accent/50',
          ].join(' ')}
        >
          <Layers className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="truncate">{group.slug}</span>
        </button>
      ))}
    </aside>
  );
}
