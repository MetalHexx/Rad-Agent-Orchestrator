// graph-service/src/http/work-graph.ts — the portfolio API: plain reads plus the portfolio graph's
// scoped write set (create/update projects, link/unlink edges, group membership, attach docs, link
// tickets) — each a thin mapping onto one `PortfolioStore` method. A Hono sub-router mounted at
// `/work-graph` by `http/app.ts`. Deletes and doc-updates (`deleteProject`/`removeWorktree`/`deleteGroup`/
// `updateDoc`/`detachDoc`/`unlinkProjectFromRef`) are intentionally out of scope and not routed
// here — this domain is CRUD (store-driven, D22), so a rejected mutation is the store's own
// structured `Result`, never re-validated here.
import { Hono } from 'hono';
import type { Context } from 'hono';
import type {
  AutoPolicy,
  DocAttachInput,
  DocOwner,
  EdgeType,
  ExternalRefUpsertInput,
  GroupCreateInput,
  LinkProjectToRefInput,
  ProjectCreateInput,
  ProjectStatus,
  ProjectUpdateInput,
  RefRelation,
  WorktreeInput,
} from '@rad-orchestration/graph-store-sqlite';
import type { GraphService } from '../compose.js';
import type { FailureEnvelope, SuccessEnvelope } from './respond.js';
import { err, fromResult, ok } from './respond.js';

/** The service-supplied actor threaded through every `PortfolioStore` mutation from this host.
 * Authn is out of scope here — never a per-request identity. */
const ACTOR = 'graph-service';

type Checked<T> = SuccessEnvelope<T> | FailureEnvelope;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

/** Every route's first move: a missing/blank required string field is always the same structured
 * `400`-style rejection, never a route-specific shape. */
function requireField(raw: unknown, field: string): Checked<string> {
  if (!isNonEmptyString(raw)) return err('invalid_request', `'${field}' is required`);
  return ok(raw);
}

async function readJsonBody(c: Context): Promise<Checked<Record<string, unknown>>> {
  let parsed: unknown;
  try {
    parsed = await c.req.json();
  } catch {
    return err('invalid_request', 'request body must be valid JSON');
  }
  if (!isPlainObject(parsed)) return err('invalid_request', 'request body must be a JSON object');
  return ok(parsed);
}

const PROJECT_STATUSES = ['planning', 'in_progress', 'done', 'archived'] as const;
function isProjectStatus(value: unknown): value is ProjectStatus {
  return typeof value === 'string' && (PROJECT_STATUSES as readonly string[]).includes(value);
}

const AUTO_POLICIES = ['ask', 'always', 'never'] as const;
function isAutoPolicy(value: unknown): value is AutoPolicy {
  return typeof value === 'string' && (AUTO_POLICIES as readonly string[]).includes(value);
}

const EDGE_TYPES = ['follows', 'spawned-from'] as const;
function isEdgeType(value: unknown): value is EdgeType {
  return typeof value === 'string' && (EDGE_TYPES as readonly string[]).includes(value);
}

const REF_RELATIONS = ['implements', 'fixes', 'references'] as const;
function isRefRelation(value: unknown): value is RefRelation {
  return typeof value === 'string' && (REF_RELATIONS as readonly string[]).includes(value);
}

/** Structural validation for `POST|DELETE /link`'s shared `{ from, to, type }` shape — both
 * routes parse the same three fields, one from the JSON body and one from query params. */
function parseEdgeParams(
  from: unknown,
  to: unknown,
  type: unknown,
): Checked<{ from: string; to: string; type: EdgeType }> {
  if (!isNonEmptyString(from)) return err('invalid_request', "'from' is required");
  if (!isNonEmptyString(to)) return err('invalid_request', "'to' is required");
  if (!isEdgeType(type)) return err('invalid_request', `'type' must be one of: ${EDGE_TYPES.join(', ')}`);
  return ok({ from, to, type });
}

/** Parses a `DocOwner` request arc — exactly one of `dagNode`/`project`/`group` must be named,
 * mirroring the type's own exactly-one-owner shape (see `portfolio-types.ts`). */
function parseDocOwner(raw: unknown): Checked<DocOwner> {
  if (!isPlainObject(raw)) return err('invalid_request', "'owner' must be an object");
  const arcs = (['dagNode', 'project', 'group'] as const).filter((key) => key in raw);
  if (arcs.length !== 1) {
    return err('invalid_request', "'owner' must name exactly one of 'dagNode', 'project', or 'group'");
  }
  if (arcs[0] === 'dagNode') {
    const dagNode = raw.dagNode;
    if (!isPlainObject(dagNode) || !isNonEmptyString(dagNode.projectId) || !isNonEmptyString(dagNode.nodeId)) {
      return err('invalid_request', "'owner.dagNode' requires string 'projectId' and 'nodeId'");
    }
    return ok({ dagNode: { projectId: dagNode.projectId, nodeId: dagNode.nodeId } });
  }
  if (arcs[0] === 'project') {
    if (!isNonEmptyString(raw.project)) return err('invalid_request', "'owner.project' must be a non-empty string");
    return ok({ project: raw.project });
  }
  if (!isNonEmptyString(raw.group)) return err('invalid_request', "'owner.group' must be a non-empty string");
  return ok({ group: raw.group });
}

/** Builds the `/work-graph` sub-router, closed over `service` — every handler reaches state
 * exclusively through it, never a module-level singleton. Mounted onto the main app by
 * `http/app.ts` via `app.route('/work-graph', buildWorkGraphRouter(service))`. */
export function buildWorkGraphRouter(service: GraphService): Hono {
  const app = new Hono();

  // ── reads (plain queries, never a business-rule check of their own) ──────────────────────
  app.get('/projects', (c) => c.json(ok(service.portfolio.listProjects())));

  app.get('/project', (c) => {
    const idResult = requireField(c.req.query('id'), 'id');
    if (!idResult.ok) return c.json(idResult, 400);
    const id = idResult.data;
    const project = service.portfolio.getProject(id);
    if (!project) return c.json(err('not_found', `project '${id}' does not exist`), 404);
    return c.json(
      ok({
        project,
        worktrees: service.portfolio.listWorktrees(id),
        docs: service.portfolio.listDocsForProject(id),
        edgesFrom: service.portfolio.listEdgesFrom(id),
        edgesTo: service.portfolio.listEdgesTo(id),
      }),
    );
  });

  // `/groups` aliases `/group`: the store has no separate "list all groups" query (only
  // `getGroup` + `listGroupChildren` for one group at a time), so both names resolve the same
  // one-group-plus-children read.
  const readGroup = (c: Context) => {
    const idResult = requireField(c.req.query('id'), 'id');
    if (!idResult.ok) return c.json(idResult, 400);
    const id = idResult.data;
    const group = service.portfolio.getGroup(id);
    if (!group) return c.json(err('not_found', `group '${id}' does not exist`), 404);
    return c.json(ok({ group, children: service.portfolio.listGroupChildren(id) }));
  };
  app.get('/group', readGroup);
  app.get('/groups', readGroup);

  app.get('/docs', (c) => {
    const project = c.req.query('project');
    const group = c.req.query('group');
    const node = c.req.query('node');

    if (isNonEmptyString(node)) {
      if (!isNonEmptyString(project)) {
        return c.json(err('invalid_request', "'node' query requires 'project' to scope it"), 400);
      }
      return c.json(ok(service.portfolio.listDocsForOwner({ dagNode: { projectId: project, nodeId: node } })));
    }
    if (isNonEmptyString(group)) {
      return c.json(ok(service.portfolio.listDocsForOwner({ group })));
    }
    if (isNonEmptyString(project)) {
      return c.json(ok(service.portfolio.listDocsForProject(project)));
    }
    return c.json(err('invalid_request', "one of 'project', 'group', or 'node' query params is required"), 400);
  });

  // ── writes (each maps to one PortfolioStore mutation; its Result becomes the envelope as-is) ─
  app.post('/project', async (c) => {
    const bodyResult = await readJsonBody(c);
    if (!bodyResult.ok) return c.json(bodyResult, 400);
    const body = bodyResult.data;

    const idResult = requireField(body.id, 'id');
    if (!idResult.ok) return c.json(idResult, 400);

    const { projectType, status, groupId, autoCommit, autoPr, sourceControlInitialized } = body;
    if (projectType !== undefined && !isNullableString(projectType)) {
      return c.json(err('invalid_request', "'projectType' must be a string or null when present"), 400);
    }
    if (status !== undefined && !isProjectStatus(status)) {
      return c.json(err('invalid_request', `'status' must be one of: ${PROJECT_STATUSES.join(', ')}`), 400);
    }
    if (groupId !== undefined && !isNullableString(groupId)) {
      return c.json(err('invalid_request', "'groupId' must be a string or null when present"), 400);
    }
    if (autoCommit !== undefined && !isAutoPolicy(autoCommit)) {
      return c.json(err('invalid_request', `'autoCommit' must be one of: ${AUTO_POLICIES.join(', ')}`), 400);
    }
    if (autoPr !== undefined && !isAutoPolicy(autoPr)) {
      return c.json(err('invalid_request', `'autoPr' must be one of: ${AUTO_POLICIES.join(', ')}`), 400);
    }
    if (sourceControlInitialized !== undefined && typeof sourceControlInitialized !== 'boolean') {
      return c.json(err('invalid_request', "'sourceControlInitialized' must be a boolean when present"), 400);
    }

    const input: ProjectCreateInput = {
      id: idResult.data,
      projectType,
      status,
      groupId,
      autoCommit,
      autoPr,
      sourceControlInitialized,
    };
    const result = service.portfolio.createProject(input, ACTOR);
    return c.json(fromResult(result), result.ok ? 200 : 400);
  });

  app.patch('/project', async (c) => {
    const idResult = requireField(c.req.query('id'), 'id');
    if (!idResult.ok) return c.json(idResult, 400);

    const bodyResult = await readJsonBody(c);
    if (!bodyResult.ok) return c.json(bodyResult, 400);
    const { status, autoCommit, autoPr } = bodyResult.data;

    if (status !== undefined && !isProjectStatus(status)) {
      return c.json(err('invalid_request', `'status' must be one of: ${PROJECT_STATUSES.join(', ')}`), 400);
    }
    if (autoCommit !== undefined && !isAutoPolicy(autoCommit)) {
      return c.json(err('invalid_request', `'autoCommit' must be one of: ${AUTO_POLICIES.join(', ')}`), 400);
    }
    if (autoPr !== undefined && !isAutoPolicy(autoPr)) {
      return c.json(err('invalid_request', `'autoPr' must be one of: ${AUTO_POLICIES.join(', ')}`), 400);
    }

    const patch: ProjectUpdateInput = { status, autoCommit, autoPr };
    const result = service.portfolio.updateProject(idResult.data, patch, ACTOR);
    return c.json(fromResult(result), result.ok ? 200 : 400);
  });

  app.post('/worktree', async (c) => {
    const bodyResult = await readJsonBody(c);
    if (!bodyResult.ok) return c.json(bodyResult, 400);
    const body = bodyResult.data;

    const projectIdResult = requireField(body.projectId, 'projectId');
    if (!projectIdResult.ok) return c.json(projectIdResult, 400);
    const repoResult = requireField(body.repo, 'repo');
    if (!repoResult.ok) return c.json(repoResult, 400);

    const { path, branch, baseBranch, prUrl } = body;
    if (path !== undefined && !isNullableString(path)) {
      return c.json(err('invalid_request', "'path' must be a string or null when present"), 400);
    }
    if (branch !== undefined && !isNullableString(branch)) {
      return c.json(err('invalid_request', "'branch' must be a string or null when present"), 400);
    }
    if (baseBranch !== undefined && !isNullableString(baseBranch)) {
      return c.json(err('invalid_request', "'baseBranch' must be a string or null when present"), 400);
    }
    if (prUrl !== undefined && !isNullableString(prUrl)) {
      return c.json(err('invalid_request', "'prUrl' must be a string or null when present"), 400);
    }

    const input: WorktreeInput = {
      projectId: projectIdResult.data,
      repo: repoResult.data,
      path,
      branch,
      baseBranch,
      prUrl,
    };
    const result = service.portfolio.addWorktree(input, ACTOR);
    return c.json(fromResult(result), result.ok ? 200 : 400);
  });

  app.post('/link', async (c) => {
    const bodyResult = await readJsonBody(c);
    if (!bodyResult.ok) return c.json(bodyResult, 400);
    const { from, to, type } = bodyResult.data;
    const parsed = parseEdgeParams(from, to, type);
    if (!parsed.ok) return c.json(parsed, 400);
    const result = service.portfolio.addEdge(parsed.data.from, parsed.data.to, parsed.data.type, ACTOR);
    return c.json(fromResult(result), result.ok ? 200 : 400);
  });

  app.delete('/link', (c) => {
    const parsed = parseEdgeParams(c.req.query('from'), c.req.query('to'), c.req.query('type'));
    if (!parsed.ok) return c.json(parsed, 400);
    const result = service.portfolio.removeEdge(parsed.data.from, parsed.data.to, parsed.data.type, ACTOR);
    return c.json(fromResult(result), result.ok ? 200 : 400);
  });

  app.post('/group', async (c) => {
    const bodyResult = await readJsonBody(c);
    if (!bodyResult.ok) return c.json(bodyResult, 400);
    const body = bodyResult.data;

    const idResult = requireField(body.id, 'id');
    if (!idResult.ok) return c.json(idResult, 400);
    const { description, name, parentGroupId } = body;
    // Blank-after-trim is the store's own business rule (`createGroup` -> `invalid_delta`), so
    // only the JSON *type* is checked here, never emptiness.
    if (typeof description !== 'string') {
      return c.json(err('invalid_request', "'description' is required and must be a string"), 400);
    }
    if (name !== undefined && !isNullableString(name)) {
      return c.json(err('invalid_request', "'name' must be a string or null when present"), 400);
    }
    if (parentGroupId !== undefined && !isNullableString(parentGroupId)) {
      return c.json(err('invalid_request', "'parentGroupId' must be a string or null when present"), 400);
    }

    const input: GroupCreateInput = { id: idResult.data, description, name, parentGroupId };
    const result = service.portfolio.createGroup(input, ACTOR);
    return c.json(fromResult(result), result.ok ? 200 : 400);
  });

  app.post('/group/member', async (c) => {
    const bodyResult = await readJsonBody(c);
    if (!bodyResult.ok) return c.json(bodyResult, 400);
    const body = bodyResult.data;

    const projectIdResult = requireField(body.projectId, 'projectId');
    if (!projectIdResult.ok) return c.json(projectIdResult, 400);
    const { groupId } = body;
    if (!isNullableString(groupId)) {
      return c.json(err('invalid_request', "'groupId' is required and must be a string or null"), 400);
    }
    const result = service.portfolio.setProjectGroup(projectIdResult.data, groupId, ACTOR);
    return c.json(fromResult(result), result.ok ? 200 : 400);
  });

  app.post('/group/parent', async (c) => {
    const bodyResult = await readJsonBody(c);
    if (!bodyResult.ok) return c.json(bodyResult, 400);
    const body = bodyResult.data;

    const groupIdResult = requireField(body.groupId, 'groupId');
    if (!groupIdResult.ok) return c.json(groupIdResult, 400);
    const { parentGroupId } = body;
    if (!isNullableString(parentGroupId)) {
      return c.json(err('invalid_request', "'parentGroupId' is required and must be a string or null"), 400);
    }
    const result = service.portfolio.setParentGroup(groupIdResult.data, parentGroupId, ACTOR);
    return c.json(fromResult(result), result.ok ? 200 : 400);
  });

  app.post('/doc', async (c) => {
    const bodyResult = await readJsonBody(c);
    if (!bodyResult.ok) return c.json(bodyResult, 400);
    const body = bodyResult.data;

    const ownerResult = parseDocOwner(body.owner);
    if (!ownerResult.ok) return c.json(ownerResult, 400);
    const pathResult = requireField(body.path, 'path');
    if (!pathResult.ok) return c.json(pathResult, 400);
    const { docType } = body;
    if (docType !== undefined && !isNullableString(docType)) {
      return c.json(err('invalid_request', "'docType' must be a string or null when present"), 400);
    }

    const input: DocAttachInput = { path: pathResult.data, docType };
    const result = service.portfolio.attachDoc(ownerResult.data, input, ACTOR);
    return c.json(fromResult(result), result.ok ? 200 : 400);
  });

  app.post('/external-ref', async (c) => {
    const bodyResult = await readJsonBody(c);
    if (!bodyResult.ok) return c.json(bodyResult, 400);
    const body = bodyResult.data;

    const systemResult = requireField(body.system, 'system');
    if (!systemResult.ok) return c.json(systemResult, 400);
    const externalIdResult = requireField(body.externalId, 'externalId');
    if (!externalIdResult.ok) return c.json(externalIdResult, 400);
    const projectIdResult = requireField(body.projectId, 'projectId');
    if (!projectIdResult.ok) return c.json(projectIdResult, 400);

    const { url, refType, parentRefId, data, relation, isPrimary } = body;
    if (!isNullableString(url)) {
      return c.json(err('invalid_request', "'url' is required and must be a string or null"), 400);
    }
    if (refType !== undefined && !isNullableString(refType)) {
      return c.json(err('invalid_request', "'refType' must be a string or null when present"), 400);
    }
    if (parentRefId !== undefined && !isNullableString(parentRefId)) {
      return c.json(err('invalid_request', "'parentRefId' must be a string or null when present"), 400);
    }
    if (data !== undefined && !isNullableString(data)) {
      return c.json(err('invalid_request', "'data' must be a string or null when present"), 400);
    }
    if (relation !== undefined && relation !== null && !isRefRelation(relation)) {
      return c.json(err('invalid_request', `'relation' must be null or one of: ${REF_RELATIONS.join(', ')}`), 400);
    }
    if (isPrimary !== undefined && typeof isPrimary !== 'boolean') {
      return c.json(err('invalid_request', "'isPrimary' must be a boolean when present"), 400);
    }

    const refInput: ExternalRefUpsertInput = {
      system: systemResult.data,
      externalId: externalIdResult.data,
      url,
      refType,
      parentRefId,
      data,
    };
    const refResult = service.portfolio.upsertExternalRef(refInput, ACTOR);
    if (!refResult.ok) return c.json(fromResult(refResult), 400);

    const linkInput: LinkProjectToRefInput = { relation, isPrimary };
    const linkResult = service.portfolio.linkProjectToRef(projectIdResult.data, refResult.data.id, linkInput, ACTOR);
    if (!linkResult.ok) return c.json(fromResult(linkResult), 400);

    return c.json(ok({ ref: refResult.data, link: linkResult.data }));
  });

  return app;
}
