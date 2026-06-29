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
   * (e.g., orchestrator-mediation fields that only apply on specific verdicts).
   */
  when?: (frontmatter: Record<string, unknown>) => boolean;
  /**
   * Optional absence-enforcement flag. When true, the rule asserts the field
   * is NOT present (undefined or null). Used for verdict-conditional fields
   * that must be absent on non-mediated review docs.
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
  // Iter 10 — conditional orchestrator-mediation contract. `verdict` is the
  // reviewer's raw verdict; when it is `changes_requested`, the orchestrator's
  // mediation addendum MUST supply `orchestrator_mediated`, `effective_outcome`,
  // and (iff effective_outcome is `changes_requested`) `corrective_handoff_path`.
  // When verdict is `approved` or `rejected`, all three mediation fields must
  // be absent. See ok-write-the-plan-vast-thacker.md for the contract rationale.
  code_review_completed: [
    {
      field: 'verdict',
      // Validate the raw verdict is exactly one of the three allowed values —
      // no trimming, no case normalization. A typo or stray whitespace
      // (e.g., "approved ") would otherwise slip past the conditional
      // mediation rules (which gate on exact-string match of
      // 'changes_requested') and surface as a later runtime halt from the
      // mutation's unknown-verdict branch instead of a structured frontmatter
      // error. Fail early here with a clear field-specific message so the
      // operator can fix the frontmatter and re-signal the event.
      validate: (v) => typeof v === 'string' && (v === 'approved' || v === 'changes_requested' || v === 'rejected'),
      expected: "one of 'approved', 'changes_requested', 'rejected'",
    },
    // verdict === 'changes_requested' branch — mediation fields required
    {
      field: 'orchestrator_mediated',
      validate: (v) => v === true,
      expected: 'true (orchestrator mediation required for changes_requested verdicts)',
      when: (fm) => fm.verdict === 'changes_requested',
    },
    {
      field: 'effective_outcome',
      validate: (v) => v === 'approved' || v === 'changes_requested',
      expected: "'approved' or 'changes_requested'",
      when: (fm) => fm.verdict === 'changes_requested',
    },
    // When effective_outcome is changes_requested, corrective_handoff_path is
    // OPTIONAL. Absence is the orchestrator's budget-exhausted halt signal —
    // the mutation reads effective_outcome=changes_requested + no handoff path
    // as "orchestrator declined to author a handoff because budget is blown"
    // and converts it into a clean pipeline halt. When supplied, the path must
    // be a non-empty string (whitespace-only is rejected).
    {
      field: 'corrective_handoff_path',
      validate: (v) => typeof v === 'string' && v.trim().length > 0,
      expected: 'a non-empty string when supplied',
      when: (fm) => fm.verdict === 'changes_requested'
        && fm.effective_outcome === 'changes_requested'
        && fm.corrective_handoff_path !== undefined
        && fm.corrective_handoff_path !== null,
    },
    {
      field: 'corrective_handoff_path',
      validate: () => true,
      expected: 'absent (must be omitted when effective_outcome is approved)',
      when: (fm) => fm.verdict === 'changes_requested' && fm.effective_outcome === 'approved',
      mustBeAbsent: true,
    },
    // verdict ∈ {'approved','rejected'} branch — mediation fields must be absent
    {
      field: 'orchestrator_mediated',
      validate: () => true,
      expected: 'absent (only permitted on changes_requested verdicts)',
      when: (fm) => fm.verdict === 'approved' || fm.verdict === 'rejected',
      mustBeAbsent: true,
    },
    {
      field: 'effective_outcome',
      validate: () => true,
      expected: 'absent (only permitted on changes_requested verdicts)',
      when: (fm) => fm.verdict === 'approved' || fm.verdict === 'rejected',
      mustBeAbsent: true,
    },
    {
      field: 'corrective_handoff_path',
      validate: () => true,
      expected: 'absent (only permitted on changes_requested verdicts)',
      when: (fm) => fm.verdict === 'approved' || fm.verdict === 'rejected',
      mustBeAbsent: true,
    },
  ],
  // Iter 11 — conditional orchestrator-mediation contract (parallels iter-10
  // code_review_completed). `verdict` is the reviewer's raw verdict; when it is
  // `changes_requested`, the orchestrator's mediation addendum MUST supply
  // `orchestrator_mediated`, `effective_outcome`, and (iff effective_outcome is
  // `changes_requested`) `corrective_handoff_path`. When verdict is `approved`
  // or `rejected`, all three mediation fields must be absent. The mutation
  // layer is `mutations.ts` PHASE_REVIEW_COMPLETED; the operator-facing write
  // surface + judgment rubric lives in
  // `harness-files/skills/rad-orchestration/references/corrective-playbook.md`
  // (Phase-Scope Mediation section).
  phase_review_completed: [
    {
      field: 'verdict',
      // Validate the raw verdict is exactly one of the three allowed values —
      // no trimming, no case normalization. A typo or stray whitespace
      // (e.g., "approved ") would otherwise slip past the conditional
      // mediation rules (which gate on exact-string match of
      // 'changes_requested') and surface as a later runtime halt from the
      // mutation's unknown-verdict branch instead of a structured frontmatter
      // error. Fail early here with a clear field-specific message so the
      // operator can fix the frontmatter and re-signal the event.
      validate: (v) => typeof v === 'string' && (v === 'approved' || v === 'changes_requested' || v === 'rejected'),
      expected: "one of 'approved', 'changes_requested', 'rejected'",
    },
    {
      field: 'exit_criteria_met',
      validate: (v) => v !== undefined && v !== null,
      expected: 'a defined value',
    },
    // verdict === 'changes_requested' branch — mediation fields required
    {
      field: 'orchestrator_mediated',
      validate: (v) => v === true,
      expected: 'true (orchestrator mediation required for changes_requested verdicts)',
      when: (fm) => fm.verdict === 'changes_requested',
    },
    {
      field: 'effective_outcome',
      validate: (v) => v === 'approved' || v === 'changes_requested',
      expected: "'approved' or 'changes_requested'",
      when: (fm) => fm.verdict === 'changes_requested',
    },
    // When effective_outcome is changes_requested, corrective_handoff_path is
    // OPTIONAL. Absence is the orchestrator's budget-exhausted halt signal —
    // the mutation reads effective_outcome=changes_requested + no handoff path
    // as "orchestrator declined to author a handoff because budget is blown"
    // and converts it into a clean pipeline halt. When supplied, the path must
    // be a non-empty string (whitespace-only is rejected).
    {
      field: 'corrective_handoff_path',
      validate: (v) => typeof v === 'string' && v.trim().length > 0,
      expected: 'a non-empty string when supplied',
      when: (fm) => fm.verdict === 'changes_requested'
        && fm.effective_outcome === 'changes_requested'
        && fm.corrective_handoff_path !== undefined
        && fm.corrective_handoff_path !== null,
    },
    {
      field: 'corrective_handoff_path',
      validate: () => true,
      expected: 'absent (must be omitted when effective_outcome is approved)',
      when: (fm) => fm.verdict === 'changes_requested' && fm.effective_outcome === 'approved',
      mustBeAbsent: true,
    },
    // verdict ∈ {'approved','rejected'} branch — mediation fields must be absent
    {
      field: 'orchestrator_mediated',
      validate: () => true,
      expected: 'absent (only permitted on changes_requested verdicts)',
      when: (fm) => fm.verdict === 'approved' || fm.verdict === 'rejected',
      mustBeAbsent: true,
    },
    {
      field: 'effective_outcome',
      validate: () => true,
      expected: 'absent (only permitted on changes_requested verdicts)',
      when: (fm) => fm.verdict === 'approved' || fm.verdict === 'rejected',
      mustBeAbsent: true,
    },
    {
      field: 'corrective_handoff_path',
      validate: () => true,
      expected: 'absent (only permitted on changes_requested verdicts)',
      when: (fm) => fm.verdict === 'approved' || fm.verdict === 'rejected',
      mustBeAbsent: true,
    },
  ],
  // Iter 12 — final_review_completed verdict enum check. Final-review
  // corrective cycles are out of scope (final review is strict-verdict-only;
  // no orchestrator mediation is wired for it). The validator enforces that
  // the reviewer always supplies a valid verdict; mediation fields
  // (`orchestrator_mediated`, `effective_outcome`, `corrective_handoff_path`)
  // are not checked here because they are not part of the final-review
  // contract. A future iteration that wires final-review mediation can extend
  // this rule set with conditional mediation-field rules parallel to the
  // iter-10 code_review_completed + iter-11 phase_review_completed shape.
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

    // Absence-enforcement rules — the field must NOT be present.
    // Used by the Iter-10 code_review_completed contract to forbid orchestrator
    // mediation fields on raw approved/rejected verdicts.
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
