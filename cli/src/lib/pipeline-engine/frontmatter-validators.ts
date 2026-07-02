export interface ValidationError {
  error: string;
  event: string;
  field: string;
}

export interface FrontmatterValidationRule {
  field: string;
  validate: (value: unknown) => boolean;
  expected: string;
  /**
   * Optional predicate. When defined and it returns false for the given
   * frontmatter, the rule is skipped — the validator does not run the
   * presence check or the validate callback. Enables conditional rule groups
   * (e.g., a field required only on a specific verdict).
   */
  when?: (frontmatter: Record<string, unknown>) => boolean;
  /**
   * Optional absence-enforcement flag. When true, the rule asserts the field
   * is NOT present (undefined or null). Generic infra retained for conditional
   * absence checks; no rule set currently uses it.
   */
  mustBeAbsent?: boolean;
}

/**
 * Converts string 'null' or 'undefined' to JavaScript null.
 * All other values pass through unchanged.
 */
export function coerceNull(value: unknown): unknown {
  if (value === 'null' || value === 'undefined') return null;
  return value;
}

const VALIDATION_RULES: Record<string, FrontmatterValidationRule[]> = {
  plan_approved: [
    {
      field: 'total_phases',
      validate: (v) => typeof v === 'number' && Number.isInteger(v) && v > 0,
      expected: 'a positive integer',
    },
    {
      field: 'total_tasks',
      validate: (v) => typeof v === 'number' && Number.isInteger(v) && v > 0,
      expected: 'a positive integer',
    },
  ],
  // Retained post-Iter 7: event no longer fires, but the phase-plan document
  // contract is still live (explosion-script-authored; consumed downstream).
  // Keeps the rule shape as a schema reference for the existing doc format.
  phase_plan_created: [
    {
      field: 'tasks',
      validate: (v) => Array.isArray(v) && (v as unknown[]).length > 0,
      expected: 'a non-empty array',
    },
  ],
  // PO-4 — the reviewer's raw `verdict` is the sole routing input. A coder
  // self-mediates its own review, so there is no orchestrator-authored
  // mediation contract: the validator only enforces that the reviewer supplied
  // a recognized verdict. The mutation layer (`mutations.ts`
  // CODE_REVIEW_COMPLETED) routes corrective birth / halt off that raw verdict.
  code_review_completed: [
    {
      field: 'verdict',
      // Validate the raw verdict is exactly one of the three allowed values —
      // no trimming, no case normalization. A typo or stray whitespace
      // (e.g., "approved ") is caught here with a clear field-specific message
      // rather than surfacing later as the mutation's unknown-verdict halt, so
      // the operator can fix the frontmatter and re-signal the event.
      validate: (v) => typeof v === 'string' && (v === 'approved' || v === 'changes_requested' || v === 'rejected'),
      expected: "one of 'approved', 'changes_requested', 'rejected'",
    },
  ],
  // PO-4 — phase review carries a raw `verdict` (sole routing input, as with
  // code_review_completed) plus `exit_criteria_met`. No orchestrator-mediation
  // fields are checked; the mutation layer (`mutations.ts`
  // PHASE_REVIEW_COMPLETED) routes corrective birth / halt off the raw verdict.
  phase_review_completed: [
    {
      field: 'verdict',
      // Validate the raw verdict is exactly one of the three allowed values —
      // no trimming, no case normalization. A typo or stray whitespace is
      // caught here with a clear field-specific message rather than surfacing
      // later as the mutation's unknown-verdict halt.
      validate: (v) => typeof v === 'string' && (v === 'approved' || v === 'changes_requested' || v === 'rejected'),
      expected: "one of 'approved', 'changes_requested', 'rejected'",
    },
    {
      field: 'exit_criteria_met',
      validate: (v) => v !== undefined && v !== null,
      expected: 'a defined value',
    },
  ],
  // final_review_completed verdict enum check. Final-review corrective cycles
  // are out of scope (final review is strict-verdict-only). The validator
  // enforces that the reviewer always supplies a valid verdict.
  final_review_completed: [
    {
      field: 'verdict',
      validate: (v) => typeof v === 'string' && (v === 'approved' || v === 'changes_requested' || v === 'rejected'),
      expected: "one of 'approved', 'changes_requested', 'rejected'",
    },
  ],
};

/**
 * Returns validation rules for a given event name.
 * Returns an empty array if the event has no frontmatter validation.
 */
export function getValidationRules(event: string): FrontmatterValidationRule[] {
  return VALIDATION_RULES[event] ?? [];
}

/**
 * Validates frontmatter fields for a specific event.
 * Returns null if valid, or a ValidationError for the first failing field.
 */
export function validateFrontmatter(
  event: string,
  frontmatter: Record<string, unknown>,
  _docPath: string,
): ValidationError | null {
  const rules = getValidationRules(event);

  for (const rule of rules) {
    // Conditional predicate — skip the rule when `when` returns false.
    // Note: the predicate runs against the raw frontmatter (not coerced) so
    // verdict-conditional rules see the same value the rest of the validator
    // accepts as legitimate input.
    if (rule.when !== undefined && !rule.when(frontmatter)) {
      continue;
    }

    let value = frontmatter[rule.field];

    // Apply coerceNull for verdict fields only
    if (rule.field === 'verdict') {
      value = coerceNull(value);
    }

    // Absence-enforcement rules — the field must NOT be present. Generic infra;
    // no rule set currently uses it (retained for conditional absence checks).
    if (rule.mustBeAbsent) {
      if (value !== undefined && value !== null) {
        return {
          error: `Invalid value: ${rule.field} must be ${rule.expected}`,
          event,
          field: rule.field,
        };
      }
      continue;
    }

    // Presence check — missing means undefined or null
    if (value === undefined || value === null) {
      return { error: 'Missing required field', event, field: rule.field };
    }

    // Special two-step validation for tasks to produce distinct error messages
    if (rule.field === 'tasks') {
      if (!Array.isArray(value)) {
        return { error: 'Invalid value: tasks must be an array', event, field: rule.field };
      }
      if ((value as unknown[]).length === 0) {
        return { error: 'Invalid value: tasks must be a non-empty array', event, field: rule.field };
      }
    } else if (!rule.validate(value)) {
      return {
        error: `Invalid value: ${rule.field} must be ${rule.expected}`,
        event,
        field: rule.field,
      };
    }
  }

  return null;
}
