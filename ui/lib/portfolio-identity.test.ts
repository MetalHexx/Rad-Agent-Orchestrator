import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import type { FsReads } from './portfolio-identity';
import { findRootDir, readLifecycle, resolveGroupByValue } from './portfolio-identity';

const PROJECTS_DIR = path.join('root', 'projects');
const inProjects = (...segments: string[]) => path.join(PROJECTS_DIR, ...segments);

function stubFs(spec: { files?: Record<string, string>; listings?: Record<string, string[]> } = {}): FsReads {
  const files = spec.files ?? {};
  const listings = spec.listings ?? {};
  return {
    exists: (p) => p in files,
    readFile: (p) => files[p] ?? '',
    readDirNames: (p) => listings[p] ?? [],
    isDirectory: (p) => p in listings,
  };
}

// ── resolveGroupByValue ──────────────────────────────────────────────────────

test('an exact id/slug match wins over an unrelated group whose display name collides, in either list order', () => {
  // group:beta's display name has drifted to coincidentally equal group:alpha's own
  // slug — 'alpha' must always resolve to group:alpha, whichever one comes first.
  const idMatch = { id: 'group:alpha', name: 'Something Else' };
  const nameMatch = { id: 'group:beta', name: 'ALPHA' };

  assert.equal(resolveGroupByValue([idMatch, nameMatch], 'alpha'), idMatch);
  assert.equal(resolveGroupByValue([nameMatch, idMatch], 'alpha'), idMatch);
});

test('a bare slug, a prefixed id, and a display name all resolve the same group, case-insensitively', () => {
  const group = { id: 'group:rad-orc', name: 'RAD.ORC' };
  const groups = [group];
  assert.equal(resolveGroupByValue(groups, 'rad-orc'), group);
  assert.equal(resolveGroupByValue(groups, 'GROUP:RAD-ORC'), group);
  assert.equal(resolveGroupByValue(groups, 'rad.orc'), group);
});

test('resolveGroupByValue returns null when nothing matches', () => {
  assert.equal(resolveGroupByValue([{ id: 'group:alpha', name: 'Alpha' }], 'beta'), null);
});

// ── findRootDir ──────────────────────────────────────────────────────────────

test('findRootDir matches the directory case-insensitively but only when it holds its own root document', () => {
  const fs = stubFs({
    files: { [inProjects('PORTFOLIO-ROOT', 'PORTFOLIO-ROOT.md')]: 'root' },
    listings: { [PROJECTS_DIR]: ['PORTFOLIO-ROOT'] },
  });
  assert.equal(findRootDir(PROJECTS_DIR, 'PORTFOLIO', fs), 'PORTFOLIO-ROOT');
  assert.equal(findRootDir(PROJECTS_DIR, 'portfolio', fs), 'PORTFOLIO-ROOT');
});

test('findRootDir returns null for a bare directory carrying no root document', () => {
  const fs = stubFs({ listings: { [PROJECTS_DIR]: ['FRESH-ROOT'] } });
  assert.equal(findRootDir(PROJECTS_DIR, 'FRESH', fs), null);
});

test('findRootDir returns null when no directory matches at all', () => {
  const fs = stubFs({ listings: { [PROJECTS_DIR]: ['PORTFOLIO-ROOT'] } });
  assert.equal(findRootDir(PROJECTS_DIR, 'NOPE', fs), null);
});

// ── readLifecycle ────────────────────────────────────────────────────────────

const DOC = inProjects('PORTFOLIO-ROOT', 'PORTFOLIO-ROOT.md');
const lifecycleOf = (body: string) => readLifecycle(DOC, stubFs({ files: { [DOC]: body } }));

test('readLifecycle reads a valid status out of the frontmatter', () => {
  assert.equal(lifecycleOf('---\nstatus: active\n---\nBody\n'), 'active');
  assert.equal(lifecycleOf('---\nstatus: on-hold\n---\nBody\n'), 'on-hold');
  assert.equal(lifecycleOf('---\nstatus: done\n---\nBody\n'), 'done');
});

test('readLifecycle degrades to null for a missing document, absent frontmatter, malformed YAML, or an off-enum status', () => {
  assert.equal(readLifecycle(DOC, stubFs()), null, 'unreadable document');
  assert.equal(lifecycleOf('No frontmatter here.\n'), null);
  assert.equal(lifecycleOf('---\nstatus: "unterminated\n---\nBody\n'), null, 'malformed YAML must not throw');
  assert.equal(lifecycleOf('---\nstatus: retired\n---\nBody\n'), null, 'a status outside the enum is not a lifecycle');
  assert.equal(lifecycleOf('---\ntitle: no status key\n---\nBody\n'), null);
});
