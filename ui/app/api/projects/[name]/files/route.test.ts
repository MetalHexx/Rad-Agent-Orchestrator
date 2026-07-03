import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { withHomedir } from '../../../../../lib/test-helpers.js';
import { GET } from './route.js';

function req(name: string): import('next/server').NextRequest {
  const url = new URL(`http://localhost/api/projects/${name}/files`);
  return { nextUrl: url } as unknown as import('next/server').NextRequest;
}

test('returns requirementsStatus "draft" for a draft Requirements doc, alongside unchanged files/mtimes', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'files-route-'));
  try {
    const projectDir = path.join(tmp, '.radorc', 'projects', 'DEMO');
    await mkdir(projectDir, { recursive: true });
    await writeFile(
      path.join(projectDir, 'DEMO-REQUIREMENTS.md'),
      '---\nstatus: Draft\n---\n\n# Requirements\n',
      'utf-8',
    );
    await writeFile(path.join(projectDir, 'DEMO-BRAINSTORMING.md'), '# Brainstorm\n', 'utf-8');
    await withHomedir(tmp, async () => {
      const res = await GET(req('DEMO'), { params: { name: 'DEMO' } });
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.requirementsStatus, 'draft');
      assert.ok(Array.isArray(json.files));
      assert.ok(json.files.includes('DEMO-REQUIREMENTS.md'));
      assert.ok(json.files.includes('DEMO-BRAINSTORMING.md'));
      assert.equal(typeof json.mtimes['DEMO-REQUIREMENTS.md'], 'number');
    });
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

test('returns requirementsStatus "approved" for an approved Requirements doc', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'files-route-'));
  try {
    const projectDir = path.join(tmp, '.radorc', 'projects', 'DEMO');
    await mkdir(projectDir, { recursive: true });
    await writeFile(
      path.join(projectDir, 'DEMO-REQUIREMENTS.md'),
      '---\nstatus: Approved\n---\n\n# Requirements\n',
      'utf-8',
    );
    await withHomedir(tmp, async () => {
      const res = await GET(req('DEMO'), { params: { name: 'DEMO' } });
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.requirementsStatus, 'approved');
    });
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

test('returns requirementsStatus null when the Requirements doc is absent', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'files-route-'));
  try {
    const projectDir = path.join(tmp, '.radorc', 'projects', 'DEMO');
    await mkdir(projectDir, { recursive: true });
    await writeFile(path.join(projectDir, 'DEMO-BRAINSTORMING.md'), '# Brainstorm\n', 'utf-8');
    await withHomedir(tmp, async () => {
      const res = await GET(req('DEMO'), { params: { name: 'DEMO' } });
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.requirementsStatus, null);
      assert.ok(json.files.includes('DEMO-BRAINSTORMING.md'));
    });
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

test('returns requirementsStatus null when the Requirements doc has no status frontmatter field', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'files-route-'));
  try {
    const projectDir = path.join(tmp, '.radorc', 'projects', 'DEMO');
    await mkdir(projectDir, { recursive: true });
    await writeFile(path.join(projectDir, 'DEMO-REQUIREMENTS.md'), '# Requirements\n\nNo frontmatter here.\n', 'utf-8');
    await withHomedir(tmp, async () => {
      const res = await GET(req('DEMO'), { params: { name: 'DEMO' } });
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.requirementsStatus, null);
    });
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

test('returns 404 for a nonexistent project, unaffected by the new field', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'files-route-'));
  try {
    await mkdir(path.join(tmp, '.radorc', 'projects'), { recursive: true });
    await withHomedir(tmp, async () => {
      const res = await GET(req('MISSING'), { params: { name: 'MISSING' } });
      assert.equal(res.status, 404);
    });
  } finally { await rm(tmp, { recursive: true, force: true }); }
});
