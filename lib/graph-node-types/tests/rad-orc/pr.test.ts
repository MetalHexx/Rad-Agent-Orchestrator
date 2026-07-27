import { describe, expect, it } from 'vitest';
import { PR_CREATED_TOKEN, PR_DATA_SCHEMA, PR_NODE_TYPE } from '../../src/rad-orc/pr.js';
import { PR_REQUEST_REPO_FIXTURE, PR_RESULT_FIXTURE } from '../fixtures/frozen-contracts.js';

describe('rad-orc:pr', () => {
  it('declares an orchestrator-inline executor and the run-command capability', () => {
    expect(PR_NODE_TYPE.name).toBe('rad-orc:pr');
    expect(PR_NODE_TYPE.traits).toEqual([]);
    expect(PR_NODE_TYPE.capabilities).toEqual(['run-command']);
  });

  it('declares its required repos data schema with worktree-repo-set resolve hint, matching the frozen PrRequestRepo shape', () => {
    expect(PR_DATA_SCHEMA.repos).toMatchObject({ kind: 'array', level: 'required', resolve: 'worktree-repo-set' });
    expect(Object.keys(PR_REQUEST_REPO_FIXTURE).sort()).toEqual(['name', 'path', 'branch', 'base_branch'].sort());
  });

  it('act runs inline (never an expansion) and returns no instructions key', () => {
    const result = PR_NODE_TYPE.act({ nodeId: 'pr-1', data: { repos: [PR_REQUEST_REPO_FIXTURE] }, nodes: [], edges: [] });
    expect(result.executor).toBe('orchestrator-inline');
    expect(result.payload).toBeUndefined();
    expect(result).not.toHaveProperty('instructions');
  });

  it('declares the pr.created completion payload schema', () => {
    expect(PR_NODE_TYPE.completionPayloadSchema).toEqual([{ name: 'repos', flag: false }]);
  });

  it('handle records the frozen {name, pr_url} shape per repo on rad-orc:pr.created', () => {
    const results = [PR_RESULT_FIXTURE];
    const result = PR_NODE_TYPE.handle({
      token: PR_CREATED_TOKEN,
      nodeId: 'pr-1',
      envelope: { outcome: 'ok', data: { results } },
    });
    expect(result).toEqual({ dataChange: { completed: true, results } });
    expect(Object.keys(results[0]).sort()).toEqual(['name', 'pr_url'].sort());
  });

  it('handle ignores an unrelated token or an error outcome', () => {
    expect(
      PR_NODE_TYPE.handle({ token: 'rad-orc:pr.other', nodeId: 'pr-1', envelope: { outcome: 'ok', data: {} } }),
    ).toEqual({});
    expect(
      PR_NODE_TYPE.handle({ token: PR_CREATED_TOKEN, nodeId: 'pr-1', envelope: { outcome: 'error', data: {} } }),
    ).toEqual({});
  });

  it('projectStatus: done once completed, not_started otherwise', () => {
    expect(PR_NODE_TYPE.projectStatus({})).toBe('not_started');
    expect(PR_NODE_TYPE.projectStatus({ completed: true, results: [PR_RESULT_FIXTURE] })).toBe('done');
  });
});
