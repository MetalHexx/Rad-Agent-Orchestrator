import { describe, expect, it } from 'vitest';
import {
  TASK_REPO_SHA_FIXTURE,
  PHASE_REPO_SHA_FIXTURE,
  FINAL_REPO_SHA_FIXTURE,
  TASK_REVIEW_FRONTMATTER_FIXTURE,
  PHASE_REVIEW_FRONTMATTER_FIXTURE,
  FINAL_REVIEW_FRONTMATTER_FIXTURE,
  TASK_HANDOFF_FRONTMATTER_FIXTURE,
  CODER_SPAWN_REQUEST_FIXTURE,
  CODER_COMMIT_RESULT_FIXTURE,
  PR_REQUEST_REPO_FIXTURE,
  PR_RESULT_FIXTURE,
  filesForRepoMarker,
} from './fixtures/frozen-contracts.js';

describe('per-level SHA field names — the load-bearing seam', () => {
  it('names the task-scope SHA field exactly `head_sha`', () => {
    expect(Object.keys(TASK_REPO_SHA_FIXTURE)).toEqual(['head_sha']);
  });

  it('names the phase-scope SHA fields exactly `phase_first_sha` + `phase_head_sha`', () => {
    expect(Object.keys(PHASE_REPO_SHA_FIXTURE)).toEqual(['phase_first_sha', 'phase_head_sha']);
  });

  it('names the final-scope SHA fields exactly `project_base_sha` + `project_head_sha`', () => {
    expect(Object.keys(FINAL_REPO_SHA_FIXTURE)).toEqual(['project_base_sha', 'project_head_sha']);
  });

  it('never collapses the three levels onto one shared field name', () => {
    const allKeys = [
      ...Object.keys(TASK_REPO_SHA_FIXTURE),
      ...Object.keys(PHASE_REPO_SHA_FIXTURE),
      ...Object.keys(FINAL_REPO_SHA_FIXTURE),
    ];
    expect(new Set(allKeys).size).toBe(allKeys.length);
  });
});

describe('review-report frontmatter — additive per-level fields', () => {
  it('every level carries the base verdict/severity/author/created fields', () => {
    for (const frontmatter of [
      TASK_REVIEW_FRONTMATTER_FIXTURE,
      PHASE_REVIEW_FRONTMATTER_FIXTURE,
      FINAL_REVIEW_FRONTMATTER_FIXTURE,
    ]) {
      expect(Object.keys(frontmatter)).toEqual(
        expect.arrayContaining(['project', 'verdict', 'severity', 'author', 'created']),
      );
    }
  });

  it('task frontmatter adds phase+task over the base fields', () => {
    expect(Object.keys(TASK_REVIEW_FRONTMATTER_FIXTURE)).toEqual(expect.arrayContaining(['phase', 'task']));
  });

  it('phase frontmatter adds phase+exit_criteria_met, never a task field', () => {
    expect(Object.keys(PHASE_REVIEW_FRONTMATTER_FIXTURE)).toEqual(
      expect.arrayContaining(['phase', 'exit_criteria_met']),
    );
    expect('task' in PHASE_REVIEW_FRONTMATTER_FIXTURE).toBe(false);
  });

  it('final frontmatter carries only the base fields — no phase/task/exit_criteria_met', () => {
    expect(Object.keys(FINAL_REVIEW_FRONTMATTER_FIXTURE).sort()).toEqual(
      ['author', 'created', 'project', 'severity', 'verdict'].sort(),
    );
  });
});

describe('task-handoff + coder spawn + PR contract shapes', () => {
  it('task-handoff frontmatter carries the frozen field set', () => {
    expect(Object.keys(TASK_HANDOFF_FRONTMATTER_FIXTURE).sort()).toEqual(
      ['project', 'phase', 'task', 'title', 'status', 'complexity', 'repos', 'created', 'type'].sort(),
    );
  });

  it('the `**Files for <repo>:**` marker is keyed by repo name', () => {
    expect(filesForRepoMarker('rad-orc-source')).toBe('**Files for rad-orc-source:**');
  });

  it('coder spawn request carries {handoff_doc, repos[], complexity, should_commit, review_report_path?}', () => {
    expect(Object.keys(CODER_SPAWN_REQUEST_FIXTURE).sort()).toEqual(
      ['handoff_doc', 'repos', 'complexity', 'should_commit'].sort(),
    );
    expect(Object.keys(CODER_SPAWN_REQUEST_FIXTURE.repos[0])).toEqual(['name', 'path', 'branch']);
  });

  it('coder commit result carries {name, committed, commitHash, pushed}', () => {
    expect(Object.keys(CODER_COMMIT_RESULT_FIXTURE).sort()).toEqual(
      ['name', 'committed', 'commitHash', 'pushed'].sort(),
    );
  });

  it('PR request repo carries {name, path, branch, base_branch}', () => {
    expect(Object.keys(PR_REQUEST_REPO_FIXTURE).sort()).toEqual(
      ['name', 'path', 'branch', 'base_branch'].sort(),
    );
  });

  it('PR result carries {name, pr_url}', () => {
    expect(Object.keys(PR_RESULT_FIXTURE).sort()).toEqual(['name', 'pr_url'].sort());
  });
});
