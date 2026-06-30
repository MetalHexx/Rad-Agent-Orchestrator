export interface FieldMeta {
  key: string;
  label: string;
  tooltip: string;
  section: string;
  controlType: 'text' | 'number' | 'switch' | 'toggle-group' | 'readonly';
  options?: string[];
  min?: number;
}

export const CONFIG_FIELDS: FieldMeta[] = [
  // 1. Version (top-level, above accordion)
  {
    key: 'version',
    label: 'Schema Version',
    tooltip: 'Schema version identifier. Read-only.',
    section: 'version',
    controlType: 'readonly',
  },

  // 2–3. Pipeline Limits Section
  {
    key: 'limits.max_retries_per_task',
    label: 'Max Retries per Task',
    tooltip:
      'How many times a failed task can be retried before halting.',
    section: 'limits',
    controlType: 'number',
    min: 0,
  },
  {
    key: 'limits.max_consecutive_review_rejections',
    label: 'Max Review Rejections',
    tooltip:
      'How many consecutive review rejections are allowed before halting the pipeline.',
    section: 'limits',
    controlType: 'number',
    min: 1,
  },

  // 6–8. Human Gates Section
  {
    key: 'human_gates.after_planning',
    label: 'After Planning Gate',
    tooltip:
      'Pause for human approval after the planning phase completes. When off, the pipeline proceeds automatically.',
    section: 'human-gates',
    controlType: 'switch',
  },
  {
    key: 'human_gates.execution_mode',
    label: 'Execution Mode',
    tooltip:
      "Controls how much human oversight is required during execution. 'ask' = confirm each step, 'phase' = confirm per phase, 'task' = confirm per task, 'autonomous' = no confirmation.",
    section: 'human-gates',
    controlType: 'toggle-group',
    options: ['ask', 'phase', 'task', 'autonomous'],
  },
  {
    key: 'human_gates.after_final_review',
    label: 'After Final Review Gate',
    tooltip:
      'Pause for human approval after the final comprehensive review. When off, the project completes automatically.',
    section: 'human-gates',
    controlType: 'switch',
  },

  // 9–10. Source Control Section
  {
    key: 'source_control.auto_commit',
    label: 'Auto Commit',
    tooltip:
      "Controls automatic git commits after tasks complete. 'always' = commit automatically, 'ask' = prompt before committing, 'never' = no auto-commits.",
    section: 'source-control',
    controlType: 'toggle-group',
    options: ['always', 'ask', 'never'],
  },
  {
    key: 'source_control.auto_pr',
    label: 'Auto PR',
    tooltip:
      "Controls automatic pull request creation after phases complete. 'always' = create PR automatically, 'ask' = prompt before creating, 'never' = no auto-PRs.",
    section: 'source-control',
    controlType: 'toggle-group',
    options: ['always', 'ask', 'never'],
  },

  // 11. Template Section
  {
    key: 'default_template',
    label: 'Default Template',
    tooltip: 'Default orchestration template to use when creating new projects.',
    section: 'template',
    controlType: 'text',
  },

  // 12. Telemetry Section
  {
    key: 'telemetry.enabled',
    label: 'Observability',
    tooltip: 'Capture neutral, non-attributed usage telemetry for harness sessions. Off by default; turning it on is opt-in.',
    section: 'telemetry',
    controlType: 'switch',
  },
];

export const CONFIG_FIELD_MAP: Record<string, FieldMeta> =
  CONFIG_FIELDS.reduce<Record<string, FieldMeta>>((map, field) => {
    map[field.key] = field;
    return map;
  }, {});
