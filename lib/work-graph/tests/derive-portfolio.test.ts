import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  isPortfolioRootDir, readPortfolioLifecycle, listPortfolios, resolvePortfolioAmong,
  portfolioRootDirName, portfolioBaseFromRootDir,
} from '../src/derive/portfolio.js';
import type { PortfolioFsReads } from '../src/derive/portfolio.js';
import { WorkGraphService } from '../src/index.js';
import { GraphIndex } from '../src/store.js';

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wg-portfolio-'));
}

function fakeFs(over: Partial<PortfolioFsReads> = {}): PortfolioFsReads {
  return {
    exists: () => false,
    readFile: () => '',
    readDirNames: () => [],
    isDirectory: () => false,
    ...over,
  };
}

/** Writes a real `{dir}/{dir}.md` root document under `projectsDir`. */
function writeRootDoc(projectsDir: string, dir: string, frontmatter: string): void {
  const full = path.join(projectsDir, dir);
  fs.mkdirSync(full, { recursive: true });
  fs.writeFileSync(path.join(full, `${dir}.md`), frontmatter);
}

/** A root document that structurally exists (so `isPortfolioRootDir` is true) but degrades to
 *  an empty read — a directory in place of a file reproduces an unreadable document without
 *  relying on filesystem permissions, which do not reliably block an owning process. */
function writeUnreadableRootDoc(projectsDir: string, dir: string): void {
  fs.mkdirSync(path.join(projectsDir, dir, `${dir}.md`), { recursive: true });
}

describe('portfolioRootDirName / portfolioBaseFromRootDir', () => {
  it('round-trips a base through the -ROOT suffix', () => {
    expect(portfolioRootDirName('PORTFOLIO')).toBe('PORTFOLIO-ROOT');
    expect(portfolioBaseFromRootDir('PORTFOLIO-ROOT')).toBe('PORTFOLIO');
  });
  it('returns null for a name with no -ROOT suffix', () => {
    expect(portfolioBaseFromRootDir('PORTFOLIO')).toBeNull();
  });
});

describe('isPortfolioRootDir', () => {
  let root: string;
  let projectsDir: string;
  beforeEach(() => { root = tmp(); projectsDir = path.join(root, 'projects'); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('true for a directory holding a document of its own name', () => {
    writeRootDoc(projectsDir, 'PORTFOLIO-ROOT', '---\nstatus: active\n---\n');
    expect(isPortfolioRootDir(projectsDir, 'PORTFOLIO-ROOT')).toBe(true);
  });
  it('false for an ordinary project directory', () => {
    fs.mkdirSync(path.join(projectsDir, 'ORDINARY-1'), { recursive: true });
    expect(isPortfolioRootDir(projectsDir, 'ORDINARY-1')).toBe(false);
  });
  it('false when the root document is missing from a -ROOT-suffixed directory', () => {
    fs.mkdirSync(path.join(projectsDir, 'EMPTY-ROOT'), { recursive: true });
    expect(isPortfolioRootDir(projectsDir, 'EMPTY-ROOT')).toBe(false);
  });
});

describe('readPortfolioLifecycle', () => {
  const withFrontmatter = (status: string) => `---\nstatus: ${status}\n---\nBody\n`;

  it.each(['active', 'on-hold', 'done'] as const)('reads status "%s" from frontmatter', (status) => {
    const fsReads = fakeFs({ readFile: () => withFrontmatter(status) });
    expect(readPortfolioLifecycle('/x/PORTFOLIO-ROOT.md', fsReads)).toBe(status);
  });
  it('returns null when frontmatter is absent', () => {
    const fsReads = fakeFs({ readFile: () => '# No frontmatter\n' });
    expect(readPortfolioLifecycle('/x/PORTFOLIO-ROOT.md', fsReads)).toBeNull();
  });
  it('returns null when status is outside the three accepted values', () => {
    const fsReads = fakeFs({ readFile: () => withFrontmatter('live') });
    expect(readPortfolioLifecycle('/x/PORTFOLIO-ROOT.md', fsReads)).toBeNull();
  });
  it('returns null when the frontmatter fails to parse', () => {
    const fsReads = fakeFs({ readFile: () => '---\nstatus: [unterminated\n---\nBody\n' });
    expect(readPortfolioLifecycle('/x/PORTFOLIO-ROOT.md', fsReads)).toBeNull();
  });
  it('returns null when the file is unreadable (readFile degrades to empty string)', () => {
    const fsReads = fakeFs({ readFile: () => '' });
    expect(readPortfolioLifecycle('/x/PORTFOLIO-ROOT.md', fsReads)).toBeNull();
  });
});

describe('listPortfolios', () => {
  let root: string;
  let projectsDir: string;
  beforeEach(() => {
    root = tmp();
    projectsDir = path.join(root, 'projects');
    writeRootDoc(projectsDir, 'ACTIVE-ROOT', '---\nstatus: active\n---\n');
    writeRootDoc(projectsDir, 'HOLD-ROOT', '---\nstatus: on-hold\n---\n');
    writeRootDoc(projectsDir, 'DONE-ROOT', '---\nstatus: done\n---\n');
    writeUnreadableRootDoc(projectsDir, 'UNREADABLE-ROOT');
    fs.mkdirSync(path.join(projectsDir, 'ORDINARY-1'), { recursive: true });
    writeRootDoc(projectsDir, '_ARCHIVED-ROOT', '---\nstatus: active\n---\n');
    fs.mkdirSync(path.join(projectsDir, 'EMPTY-ROOT'), { recursive: true });
  });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('returns every real portfolio, name-ordered, excluding non-candidates', () => {
    expect(listPortfolios(projectsDir).map((p) => p.name)).toEqual(['ACTIVE', 'DONE', 'HOLD', 'UNREADABLE']);
  });
  it('carries the lifecycle status, null for the unreadable document', () => {
    const byName = new Map(listPortfolios(projectsDir).map((p) => [p.name, p.status]));
    expect(byName.get('ACTIVE')).toBe('active');
    expect(byName.get('HOLD')).toBe('on-hold');
    expect(byName.get('DONE')).toBe('done');
    expect(byName.get('UNREADABLE')).toBeNull();
  });
  it('resolves rootProject, dir, and rootDoc to the expected absolute paths', () => {
    const active = listPortfolios(projectsDir).find((p) => p.name === 'ACTIVE');
    expect(active?.rootProject).toBe('ACTIVE-ROOT');
    expect(active?.dir).toBe(path.join(projectsDir, 'ACTIVE-ROOT'));
    expect(active?.rootDoc).toBe(path.join(projectsDir, 'ACTIVE-ROOT', 'ACTIVE-ROOT.md'));
  });
  it('returns [] rather than throwing when projectsDir does not exist', () => {
    expect(listPortfolios(path.join(root, 'does-not-exist'))).toEqual([]);
  });
});

describe('resolvePortfolioAmong', () => {
  let root: string;
  let projectsDir: string;
  beforeEach(() => {
    root = tmp();
    projectsDir = path.join(root, 'projects');
    writeRootDoc(projectsDir, 'PORTFOLIO-ROOT', '---\nstatus: active\n---\n');
    fs.mkdirSync(path.join(projectsDir, 'EMPTY-ROOT'), { recursive: true });
    fs.mkdirSync(path.join(projectsDir, 'ITERATION-1'), { recursive: true });
  });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('resolves the one member id that is a root project', () => {
    const ref = resolvePortfolioAmong(projectsDir, ['ITERATION-1', 'PORTFOLIO-ROOT']);
    expect(ref?.name).toBe('PORTFOLIO');
    expect(ref?.status).toBe('active');
  });
  it('returns null when no member is a root project', () => {
    expect(resolvePortfolioAmong(projectsDir, ['ITERATION-1'])).toBeNull();
  });
  it('returns null when the only -ROOT-suffixed member has no root document', () => {
    expect(resolvePortfolioAmong(projectsDir, ['EMPTY-ROOT'])).toBeNull();
  });
});

describe('WorkGraphService.portfolioForProject', () => {
  let root: string;
  beforeEach(() => {
    root = tmp();
    const projectsDir = path.join(root, 'projects');
    const mkProject = (name: string) => {
      const dir = path.join(projectsDir, name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ project: { name }, graph: { nodes: {} } }));
    };
    writeRootDoc(projectsDir, 'PORTFOLIO-ROOT', '---\nstatus: active\n---\n');
    fs.writeFileSync(path.join(projectsDir, 'PORTFOLIO-ROOT', 'state.json'), JSON.stringify({ project: { name: 'PORTFOLIO-ROOT' }, graph: { nodes: {} } }));
    mkProject('ITER-1');
    mkProject('ORDINARY-1');
    mkProject('UNGROUPED-1');

    new GraphIndex(root).write({
      version: 1, rev: 0,
      groups: {
        'group:portfolio': { name: 'Portfolio', description: 'the portfolio' },
        'group:ordinary': { name: 'Ordinary', description: 'a plain group' },
      },
      edges: [
        { type: 'contains', from: 'group:portfolio', to: 'PORTFOLIO-ROOT' },
        { type: 'contains', from: 'group:portfolio', to: 'ITER-1' },
        { type: 'contains', from: 'group:ordinary', to: 'ORDINARY-1' },
      ],
    }, 0);
  });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('resolves the portfolio for a project inside its portfolio group', () => {
    const svc = new WorkGraphService({ root, exec: () => '' });
    expect(svc.portfolioForProject('ITER-1')?.name).toBe('PORTFOLIO');
  });
  it('returns null for a project inside an ordinary group', () => {
    const svc = new WorkGraphService({ root, exec: () => '' });
    expect(svc.portfolioForProject('ORDINARY-1')).toBeNull();
  });
  it('returns null for an ungrouped project', () => {
    const svc = new WorkGraphService({ root, exec: () => '' });
    expect(svc.portfolioForProject('UNGROUPED-1')).toBeNull();
  });

  it('listPortfolios and resolvePortfolioAmong survive a graph read that would throw, proving neither composes', () => {
    fs.writeFileSync(path.join(root, 'work-graph.yml'), 'edges: [unterminated');
    const svc = new WorkGraphService({ root, exec: () => '' });
    expect(() => svc.getGraph()).toThrow();
    expect(() => svc.listPortfolios()).not.toThrow();
    expect(() => svc.resolvePortfolioAmong(['ITER-1'])).not.toThrow();
  });
});
