import * as path from 'node:path';

// Scalar doc-path fields enrichment may emit across the various actions
// (execute_task, spawn_code_reviewer, spawn_phase_reviewer, spawn_final_reviewer).
export const DOC_PATH_SCALAR_FIELDS = [
  'handoff_doc', 'review_report_path', 'phase_plan_doc', 'requirements_doc',
] as const;

// Array-shaped doc-path fields (currently only spawn_final_reviewer's phase_plan_paths).
export const DOC_PATH_ARRAY_FIELDS = ['phase_plan_paths'] as const;

function resolveScalar(value: string, projectDir: string): string {
  if (path.isAbsolute(value)) return value;
  return path.join(projectDir, value);
}

/**
 * Returns a NEW object (shallow clone of `context`) with every known doc-path
 * field resolved to an absolute path against `projectDir`. Every other key is
 * copied through untouched. Relative strings are joined onto `projectDir`;
 * already-absolute strings, `null`, and absent keys are left as-is. Array
 * fields are resolved element-wise with the same rule (null elements
 * preserved, order preserved). A non-string, non-null value on a listed
 * field is passed through unchanged — this is a defensive normalization
 * helper, not a validator.
 */
export function resolveDocPaths(
  context: Record<string, unknown>,
  projectDir: string,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...context };

  for (const field of DOC_PATH_SCALAR_FIELDS) {
    if (!(field in result)) continue;
    const value = result[field];
    if (typeof value === 'string') {
      result[field] = resolveScalar(value, projectDir);
    } else if (value === null) {
      result[field] = null;
    }
    // else: non-string, non-null — pass through unchanged.
  }

  for (const field of DOC_PATH_ARRAY_FIELDS) {
    if (!(field in result)) continue;
    const value = result[field];
    if (Array.isArray(value)) {
      result[field] = value.map((el) => (typeof el === 'string' ? resolveScalar(el, projectDir) : el));
    }
    // else: non-array value on a listed array field — pass through unchanged.
  }

  return result;
}
