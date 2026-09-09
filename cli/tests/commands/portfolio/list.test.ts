import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { portfolioList } from '../../../src/commands/portfolio/list.js';
import type { PortfolioListOptions } from '../../../src/commands/portfolio/list.js';
import { UserError } from '../../../src/framework/errors.js';
import type { FsReads } from '../../../src/commands/portfolio/identity.js';
import type { GraphPort } from '../../../src/commands/portfolio/graph-port.js';

const PROJECTS_DIR = path.join('root', 'projects');

// Fixture directory listing mixes: two qualifying portfolios (one with a group,
// one without), an ordinary project, an `_`-prefixed dir, a name failing
// isProjectDirName, and a "file" masquerading as a root-dir-shaped name.
const DIRS = ['PORTFOLIO-ROOT', 'STANDALONE-ROOT', 'MR-1', '_ARCHIVE', 'portfolio-root', 'DECOY-ROOT'];

const frontmatter = (status: string | null, description: string) =>
  (status ? `---\nstatus: ${status}\ndescription: ${description}\n---\nBody\n` : `---\ndescription: ${description}\n---\nBody\n`);

function fixtureFs(overrides: Partial<FsReads> = {}): FsReads {
  const files: Record<string, string> = {
    [path.join(PROJECTS_DIR, 'PORTFOLIO-ROOT', 'PORTFOLIO-ROOT.md')]: frontmatter('active', 'root doc blurb — ignored'),
    [path.join(PROJECTS_DIR, 'STANDALONE-ROOT', 'STANDALONE-ROOT.md')]: frontmatter(null, 'also ignored'),
  };
  return {
    readDirNames: () => DIRS,
    isDirectory: (p) => p !== path.join(PROJECTS_DIR, 'DECOY-ROOT'),
    exists: (p) => p in files,
    readFile: (p) => files[p] ?? '',
    ...overrides,
  };
}

function fixturePort(getGraphSpy: () => void = () => {}): GraphPort {
  const graph = {
    schema: 'work-graph/v1',
    nodes: [
      { id: 'group:portfolio', kind: 'group', name: 'Portfolio', description: 'group blurb' },
    ],
    edges: [{ type: 'contains', from: 'group:portfolio', to: 'PORTFOLIO-ROOT' }],
    danglingEdges: [],
  };
  return {
    getGraph: () => { getGraphSpy(); return graph; },
  } as unknown as GraphPort;
}

function baseOptions(over: Partial<PortfolioListOptions> = {}): PortfolioListOptions {
  return {
    projectsDir: PROJECTS_DIR,
    port: fixturePort(),
    fs: fixtureFs(),
    ...over,
  };
}

describe('portfolioList', () => {
  it('keeps only qualifying directories: excludes ordinary projects, _-prefixed dirs, invalid names, and non-directories', () => {
    const result = portfolioList(baseOptions());
    expect(result.portfolios.map((p) => p.name).sort()).toEqual(['PORTFOLIO', 'STANDALONE']);
  });

  it('sources description from the group node, not the (different) root-document frontmatter', () => {
    const entry = portfolioList(baseOptions()).portfolios.find((p) => p.name === 'PORTFOLIO')!;
    expect(entry.description).toBe('group blurb');
    expect(entry.description).not.toBe('root doc blurb — ignored');
  });

  it('reports the absolute root dir, root-document path, and group id for a member portfolio', () => {
    const entry = portfolioList(baseOptions()).portfolios.find((p) => p.name === 'PORTFOLIO')!;
    expect(entry.dir).toBe(path.join(PROJECTS_DIR, 'PORTFOLIO-ROOT'));
    expect(entry.root).toBe(path.join(PROJECTS_DIR, 'PORTFOLIO-ROOT', 'PORTFOLIO-ROOT.md'));
    expect(entry.group).toBe('group:portfolio');
    expect(entry.status).toBe('active');
  });

  it('reports group: null and description: null for a portfolio with no contains edge', () => {
    const entry = portfolioList(baseOptions()).portfolios.find((p) => p.name === 'STANDALONE')!;
    expect(entry.group).toBeNull();
    expect(entry.description).toBeNull();
  });

  it('reports status: null for a portfolio whose root document carries no status', () => {
    const entry = portfolioList(baseOptions()).portfolios.find((p) => p.name === 'STANDALONE')!;
    expect(entry.status).toBeNull();
  });

  it('calls getGraph exactly once for a multi-portfolio listing', () => {
    const spy = vi.fn();
    portfolioList(baseOptions({ port: fixturePort(spy) }));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('filters by --status, excluding a status-less portfolio', () => {
    const active = portfolioList(baseOptions({ status: 'active' })).portfolios;
    expect(active.map((p) => p.name)).toEqual(['PORTFOLIO']);
  });

  it('keeps a status-less portfolio when unfiltered', () => {
    const all = portfolioList(baseOptions()).portfolios;
    expect(all.some((p) => p.name === 'STANDALONE')).toBe(true);
  });

  it('returns an empty array, ok, when the filter matches nothing', () => {
    expect(portfolioList(baseOptions({ status: 'done' })).portfolios).toEqual([]);
  });

  it('throws UserError for an unrecognized --status before touching fs', () => {
    const readDirNames = vi.fn(() => DIRS);
    const fs = fixtureFs({ readDirNames });
    expect(() => portfolioList(baseOptions({ status: 'live', fs }))).toThrow(UserError);
    expect(readDirNames).not.toHaveBeenCalled();
  });

  it('returns { portfolios: [] } when readDirNames yields []', () => {
    const fs = fixtureFs({ readDirNames: () => [] });
    expect(portfolioList(baseOptions({ fs }))).toEqual({ portfolios: [] });
  });
});
