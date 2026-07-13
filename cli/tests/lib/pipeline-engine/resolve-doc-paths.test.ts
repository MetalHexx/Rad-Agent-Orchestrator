import * as path from 'node:path';
import { describe, it, expect } from 'vitest';
import { resolveDocPaths, DOC_PATH_SCALAR_FIELDS, DOC_PATH_ARRAY_FIELDS } from '../../../src/lib/pipeline-engine/resolve-doc-paths.js';

const PROJECT_DIR = path.resolve('/tmp/project-dir');

describe('resolveDocPaths — scalar fields', () => {
  it.each(DOC_PATH_SCALAR_FIELDS)('joins a relative %s onto projectDir using native separators', (field) => {
    const context = { [field]: 'tasks/FOO.md' };
    const result = resolveDocPaths(context, PROJECT_DIR);
    expect(result[field]).toBe(path.join(PROJECT_DIR, 'tasks/FOO.md'));
    expect(path.isAbsolute(result[field] as string)).toBe(true);
  });

  it.each(DOC_PATH_SCALAR_FIELDS)('leaves an already-absolute %s untouched', (field) => {
    const absolute = path.resolve('/elsewhere/already-absolute.md');
    const context = { [field]: absolute };
    const result = resolveDocPaths(context, PROJECT_DIR);
    expect(result[field]).toBe(absolute);
  });

  it.each(DOC_PATH_SCALAR_FIELDS)('preserves null on %s', (field) => {
    const context = { [field]: null };
    const result = resolveDocPaths(context, PROJECT_DIR);
    expect(result[field]).toBeNull();
  });

  it.each(DOC_PATH_SCALAR_FIELDS)('does not introduce %s when absent from the input', (field) => {
    const context = { unrelated: 'value' };
    const result = resolveDocPaths(context, PROJECT_DIR);
    expect(field in result).toBe(false);
  });

  it.each(DOC_PATH_SCALAR_FIELDS)('passes a non-string, non-null value on %s through unchanged', (field) => {
    const context = { [field]: 42 };
    const result = resolveDocPaths(context, PROJECT_DIR);
    expect(result[field]).toBe(42);
  });
});

describe('resolveDocPaths — array field (phase_plan_paths)', () => {
  const [arrayField] = DOC_PATH_ARRAY_FIELDS;

  it('resolves each relative element and leaves absolute elements untouched, preserving order', () => {
    const absoluteElement = path.resolve('/already/absolute/PHASE-2.md');
    const context = { [arrayField]: ['phases/PHASE-1.md', absoluteElement, null] };
    const result = resolveDocPaths(context, PROJECT_DIR);
    expect(result[arrayField]).toEqual([
      path.join(PROJECT_DIR, 'phases/PHASE-1.md'),
      absoluteElement,
      null,
    ]);
  });

  it('preserves a null element in place', () => {
    const context = { [arrayField]: [null, 'phases/PHASE-1.md'] };
    const result = resolveDocPaths(context, PROJECT_DIR);
    expect(result[arrayField]).toEqual([null, path.join(PROJECT_DIR, 'phases/PHASE-1.md')]);
  });

  it('does not introduce the array field when absent from the input', () => {
    const context = { unrelated: 'value' };
    const result = resolveDocPaths(context, PROJECT_DIR);
    expect(arrayField in result).toBe(false);
  });

  it('passes a non-array value through unchanged (defensive)', () => {
    const context = { [arrayField]: 'not-an-array' };
    const result = resolveDocPaths(context, PROJECT_DIR);
    expect(result[arrayField]).toBe('not-an-array');
  });
});

describe('resolveDocPaths — unrelated keys and object identity', () => {
  it('leaves non-doc-path keys intact', () => {
    const context = {
      handoff_doc: 'tasks/FOO.md',
      task_id: 'P01-T01',
      complexity: 'standard',
      repos: [{ name: 'r1', path: '/abs/r1' }],
      should_commit: true,
    };
    const result = resolveDocPaths(context, PROJECT_DIR);
    expect(result.task_id).toBe('P01-T01');
    expect(result.complexity).toBe('standard');
    expect(result.repos).toEqual(context.repos);
    expect(result.should_commit).toBe(true);
  });

  it('returns a new object rather than mutating the input', () => {
    const context = { handoff_doc: 'tasks/FOO.md' };
    const result = resolveDocPaths(context, PROJECT_DIR);
    expect(result).not.toBe(context);
    expect(context.handoff_doc).toBe('tasks/FOO.md');
  });

  it('handles a payload combining multiple scalar fields, an array field, and unrelated keys', () => {
    const context = {
      handoff_doc: 'tasks/FOO.md',
      review_report_path: null,
      phase_plan_paths: ['phases/PHASE-1.md', null],
      task_id: 'P01-T01',
    };
    const result = resolveDocPaths(context, PROJECT_DIR);
    expect(result).toEqual({
      handoff_doc: path.join(PROJECT_DIR, 'tasks/FOO.md'),
      review_report_path: null,
      phase_plan_paths: [path.join(PROJECT_DIR, 'phases/PHASE-1.md'), null],
      task_id: 'P01-T01',
    });
  });
});
