import { describe, it, expect } from 'vitest';
import path from 'node:path';
import {
  matchesGroup, resolveGroupByValue, docPaths, findRootDir,
  PORTFOLIO_DOC_ROLES,
} from '../../../src/commands/portfolio/identity.js';
import type { FsReads } from '../../../src/commands/portfolio/identity.js';

function fakeFs(over: Partial<FsReads> = {}): FsReads {
  return {
    exists: () => false,
    readFile: () => '',
    readDirNames: () => [],
    isDirectory: () => false,
    ...over,
  };
}

describe('matchesGroup', () => {
  const group = { id: 'group:portfolio', name: 'Portfolio' };

  it('matches a bare base, case-insensitively', () => {
    expect(matchesGroup(group, 'PORTFOLIO')).toBe(true);
  });

  it('matches a group name, case-insensitively', () => {
    expect(matchesGroup(group, 'portfolio')).toBe(true);
  });

  it('matches a full group:-prefixed id, case-insensitively', () => {
    expect(matchesGroup(group, 'GROUP:Portfolio')).toBe(true);
  });

  it('does not match on a near-name', () => {
    expect(matchesGroup(group, 'portfolios')).toBe(false);
  });
});

describe('resolveGroupByValue', () => {
  // A's display name coincidentally equals B's id/slug — a real scenario since a
  // display name can be edited independently of the id it was minted from.
  const idMatch = { id: 'group:beta', name: 'Something Else' };
  const nameMatch = { id: 'group:alpha', name: 'BETA' };

  it('resolves the exact id/slug match ahead of an unrelated display-name match, regardless of list order', () => {
    expect(resolveGroupByValue([idMatch, nameMatch], 'beta')).toBe(idMatch);
    expect(resolveGroupByValue([nameMatch, idMatch], 'beta')).toBe(idMatch);
  });

  it('falls back to a display-name match only when no id/slug match exists anywhere in the list', () => {
    expect(resolveGroupByValue([nameMatch], 'beta')).toBe(nameMatch);
  });

  it('returns null when nothing matches', () => {
    expect(resolveGroupByValue([idMatch, nameMatch], 'gamma')).toBeNull();
  });
});

describe('docPaths', () => {
  it('returns absolute paths for all five documents inside {base}-ROOT/', () => {
    const projectsDir = path.join('root', 'projects');
    const dir = path.join(projectsDir, 'PORTFOLIO-ROOT');
    const paths = docPaths(projectsDir, 'PORTFOLIO');

    expect(paths).toEqual({
      root: path.join(dir, 'PORTFOLIO-ROOT.md'),
      iterations: path.join(dir, 'PORTFOLIO-ITERATIONS.md'),
      decisions: path.join(dir, 'PORTFOLIO-DECISIONS.md'),
      technical: path.join(dir, 'PORTFOLIO-TECHNICAL.md'),
      groundTruth: path.join(dir, 'PORTFOLIO-GROUND-TRUTH.md'),
    });
    expect(Object.keys(paths).sort()).toEqual([...PORTFOLIO_DOC_ROLES].sort());
  });
});

describe('findRootDir', () => {
  it('matches a lowercase input against an uppercase directory in the real listing', () => {
    const fs = fakeFs({
      readDirNames: () => ['PORTFOLIO-ROOT', 'OTHER-ROOT'],
      exists: (p) => p === path.join('/projects', 'PORTFOLIO-ROOT', 'PORTFOLIO-ROOT.md'),
    });
    expect(findRootDir('/projects', 'portfolio', fs)).toBe('PORTFOLIO-ROOT');
  });

  it('returns null when the matching directory has no root document', () => {
    const fs = fakeFs({ readDirNames: () => ['PORTFOLIO-ROOT'], exists: () => false });
    expect(findRootDir('/projects', 'portfolio', fs)).toBeNull();
  });

  it('returns null when no directory matches at all', () => {
    const fs = fakeFs({ readDirNames: () => ['OTHER-ROOT'] });
    expect(findRootDir('/projects', 'portfolio', fs)).toBeNull();
  });
});
