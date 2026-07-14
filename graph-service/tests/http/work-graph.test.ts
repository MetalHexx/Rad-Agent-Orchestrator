// The `/work-graph/*` route surface — portfolio CRUD over the package's own production
// composition root (`compose()` + `buildApp()`, real SQLite, `app.request()` — no socket). Covers
// a representative round-trip per entity family and each route's rejection mapping; the store's
// own invariants (acyclicity, exactly-one-owner) are `graph-store-sqlite`'s own suites, not
// re-tested here.
import { describe, expect, it } from 'vitest';
import { BUILT_IN_NODE_TYPES } from '@rad-orchestration/graph-node-types';
import { compose } from '../../src/compose.js';
import { buildApp } from '../../src/http/app.js';

interface EnvelopeBody<T> {
  readonly ok: boolean;
  readonly data?: T;
  readonly error?: { readonly code: string; readonly message: string };
}

function buildTestApp() {
  return buildApp(compose({ dbPath: ':memory:', builtInNodeTypes: BUILT_IN_NODE_TYPES }));
}

function postJson(app: ReturnType<typeof buildApp>, path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function patchJson(app: ReturnType<typeof buildApp>, path: string, body: unknown) {
  return app.request(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('project CRUD', () => {
  it('creates a project, reads it back with its worktrees/docs, and updates it', async () => {
    const app = buildTestApp();

    const createRes = await postJson(app, '/work-graph/project', { id: 'proj-a' });
    expect(createRes.status).toBe(200);
    const createBody = (await createRes.json()) as EnvelopeBody<{ id: string; status: string }>;
    expect(createBody.ok).toBe(true);
    expect(createBody.data).toMatchObject({ id: 'proj-a', status: 'planning' });

    await postJson(app, '/work-graph/worktree', { projectId: 'proj-a', repo: 'rad-orc-source', branch: 'feature/x' });
    await postJson(app, '/work-graph/doc', { owner: { project: 'proj-a' }, path: 'proj-a/notes.md', docType: 'notes' });

    const listRes = await app.request('/work-graph/projects');
    const listBody = (await listRes.json()) as EnvelopeBody<Array<{ id: string }>>;
    expect(listBody.data?.map((p) => p.id)).toContain('proj-a');

    const readRes = await app.request('/work-graph/project?id=proj-a');
    expect(readRes.status).toBe(200);
    const readBody = (await readRes.json()) as EnvelopeBody<{
      project: { id: string };
      worktrees: Array<{ repo: string }>;
      docs: Array<{ path: string }>;
      edgesFrom: unknown[];
      edgesTo: unknown[];
    }>;
    expect(readBody.data?.project.id).toBe('proj-a');
    expect(readBody.data?.worktrees).toEqual([expect.objectContaining({ repo: 'rad-orc-source', branch: 'feature/x' })]);
    expect(readBody.data?.docs).toEqual([expect.objectContaining({ path: 'proj-a/notes.md', docType: 'notes' })]);

    const updateRes = await patchJson(app, '/work-graph/project?id=proj-a', { status: 'in_progress', autoCommit: 'always' });
    expect(updateRes.status).toBe(200);
    const updateBody = (await updateRes.json()) as EnvelopeBody<{ status: string; autoCommit: string }>;
    expect(updateBody.data).toMatchObject({ status: 'in_progress', autoCommit: 'always' });
  });

  it('returns a structured 404 for a project that does not exist', async () => {
    const app = buildTestApp();
    const res = await app.request('/work-graph/project?id=nope');
    expect(res.status).toBe(404);
    const body = (await res.json()) as EnvelopeBody<never>;
    expect(body.error?.code).toBe('not_found');
  });

  it("rejects a missing 'id' with a structured 400 envelope", async () => {
    const app = buildTestApp();
    const res = await app.request('/work-graph/project');
    expect(res.status).toBe(400);
    const body = (await res.json()) as EnvelopeBody<never>;
    expect(body.error?.code).toBe('invalid_request');
  });

  it('rejects a malformed status value at the HTTP boundary', async () => {
    const app = buildTestApp();
    const res = await postJson(app, '/work-graph/project', { id: 'proj-bad-status', status: 'not_a_status' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as EnvelopeBody<never>;
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe('invalid_request');
  });
});

describe('edge link/unlink', () => {
  it('links two projects (follows) and reads the reverse edge, then unlinks it', async () => {
    const app = buildTestApp();
    await postJson(app, '/work-graph/project', { id: 'proj-from' });
    await postJson(app, '/work-graph/project', { id: 'proj-to' });

    const linkRes = await postJson(app, '/work-graph/link', { from: 'proj-from', to: 'proj-to', type: 'follows' });
    expect(linkRes.status).toBe(200);
    const linkBody = (await linkRes.json()) as EnvelopeBody<{ fromProjectId: string; toProjectId: string; type: string }>;
    expect(linkBody.data).toEqual({ fromProjectId: 'proj-from', toProjectId: 'proj-to', type: 'follows' });

    const reverseRes = await app.request('/work-graph/project?id=proj-to');
    const reverseBody = (await reverseRes.json()) as EnvelopeBody<{ edgesTo: Array<{ fromProjectId: string }> }>;
    expect(reverseBody.data?.edgesTo).toEqual([{ fromProjectId: 'proj-from', toProjectId: 'proj-to', type: 'follows' }]);

    const unlinkRes = await app.request('/work-graph/link?from=proj-from&to=proj-to&type=follows', { method: 'DELETE' });
    expect(unlinkRes.status).toBe(200);

    const afterRes = await app.request('/work-graph/project?id=proj-to');
    const afterBody = (await afterRes.json()) as EnvelopeBody<{ edgesTo: unknown[] }>;
    expect(afterBody.data?.edgesTo).toEqual([]);
  });

  it('rejects an unknown edge type with a structured 400 envelope', async () => {
    const app = buildTestApp();
    const res = await postJson(app, '/work-graph/link', { from: 'a', to: 'b', type: 'blocks' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as EnvelopeBody<never>;
    expect(body.error?.code).toBe('invalid_request');
  });
});

describe('groups', () => {
  it('rejects a blank group description as a structured store rejection, not an HTTP 500', async () => {
    const app = buildTestApp();
    const res = await postJson(app, '/work-graph/group', { id: 'group-blank', description: '   ' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as EnvelopeBody<never>;
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe('invalid_delta');
  });

  it('creates a group, sets project membership and group parenting, and reads them back as children', async () => {
    const app = buildTestApp();
    await postJson(app, '/work-graph/group', { id: 'group-parent', description: 'parent group' });
    await postJson(app, '/work-graph/group', { id: 'group-child', description: 'child group' });
    await postJson(app, '/work-graph/project', { id: 'proj-member' });

    const parentRes = await postJson(app, '/work-graph/group/parent', { groupId: 'group-child', parentGroupId: 'group-parent' });
    expect(parentRes.status).toBe(200);

    const memberRes = await postJson(app, '/work-graph/group/member', { projectId: 'proj-member', groupId: 'group-parent' });
    expect(memberRes.status).toBe(200);
    const memberBody = (await memberRes.json()) as EnvelopeBody<{ groupId: string | null }>;
    expect(memberBody.data?.groupId).toBe('group-parent');

    const readRes = await app.request('/work-graph/group?id=group-parent');
    expect(readRes.status).toBe(200);
    const readBody = (await readRes.json()) as EnvelopeBody<{
      group: { id: string };
      children: { projects: Array<{ id: string }>; subGroups: Array<{ id: string }> };
    }>;
    expect(readBody.data?.children.projects.map((p) => p.id)).toEqual(['proj-member']);
    expect(readBody.data?.children.subGroups.map((g) => g.id)).toEqual(['group-child']);

    // '/groups' aliases '/group' — same handler, no separate "list all groups" store method.
    const aliasRes = await app.request('/work-graph/groups?id=group-parent');
    expect(aliasRes.status).toBe(200);
  });

  it('returns a structured 404 for a group that does not exist', async () => {
    const app = buildTestApp();
    const res = await app.request('/work-graph/group?id=nope');
    expect(res.status).toBe(404);
    const body = (await res.json()) as EnvelopeBody<never>;
    expect(body.error?.code).toBe('not_found');
  });
});

describe('docs', () => {
  it('attaches a group-owned doc and reads it back via the docs query family', async () => {
    const app = buildTestApp();
    await postJson(app, '/work-graph/group', { id: 'group-docs', description: 'group with docs' });

    const attachRes = await postJson(app, '/work-graph/doc', {
      owner: { group: 'group-docs' },
      path: 'group-docs/readme.md',
      docType: 'design',
    });
    expect(attachRes.status).toBe(200);
    const attachBody = (await attachRes.json()) as EnvelopeBody<{ id: string; groupId: string | null; path: string }>;
    expect(attachBody.data).toMatchObject({ groupId: 'group-docs', path: 'group-docs/readme.md', docType: 'design' });

    const readRes = await app.request('/work-graph/docs?group=group-docs');
    expect(readRes.status).toBe(200);
    const readBody = (await readRes.json()) as EnvelopeBody<Array<{ path: string }>>;
    expect(readBody.data).toEqual([expect.objectContaining({ path: 'group-docs/readme.md' })]);
  });

  it('rejects an owner naming zero or multiple arcs with a structured 400', async () => {
    const app = buildTestApp();
    const res = await postJson(app, '/work-graph/doc', { owner: {}, path: 'x/y.md' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as EnvelopeBody<never>;
    expect(body.error?.code).toBe('invalid_request');
  });

  it("rejects a 'node' query with no scoping 'project'", async () => {
    const app = buildTestApp();
    const res = await app.request('/work-graph/docs?node=task-1');
    expect(res.status).toBe(400);
    const body = (await res.json()) as EnvelopeBody<never>;
    expect(body.error?.code).toBe('invalid_request');
  });
});

describe('external refs', () => {
  it('upserts an external ref and links it to a project in one call', async () => {
    const app = buildTestApp();
    await postJson(app, '/work-graph/project', { id: 'proj-ticket' });

    const res = await postJson(app, '/work-graph/external-ref', {
      system: 'jira',
      externalId: 'ABC-123',
      url: 'https://example.test/ABC-123',
      projectId: 'proj-ticket',
      relation: 'implements',
      isPrimary: true,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EnvelopeBody<{
      ref: { id: string; system: string; externalId: string };
      link: { projectId: string; relation: string; isPrimary: boolean };
    }>;
    expect(body.data?.ref).toMatchObject({ system: 'jira', externalId: 'ABC-123' });
    expect(body.data?.link).toEqual({
      projectId: 'proj-ticket',
      externalRefId: body.data?.ref.id,
      relation: 'implements',
      isPrimary: true,
    });
  });

  it('surfaces a link-side rejection (unknown project) as a structured error', async () => {
    const app = buildTestApp();
    const res = await postJson(app, '/work-graph/external-ref', {
      system: 'jira',
      externalId: 'XYZ-1',
      url: null,
      projectId: 'proj-does-not-exist',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as EnvelopeBody<never>;
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe('invalid_delta');
  });
});
