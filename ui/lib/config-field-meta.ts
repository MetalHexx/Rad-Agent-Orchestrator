export interface FieldMeta {
  key: string;
  label: string;
  tooltip: string;
  section: string;
  controlType: 'text' | 'number' | 'switch' | 'toggle-group' | 'select' | 'readonly';
  options?: string[];                       // static enums only
  optionsSource?: 'communication-styles';   // runtime-sourced; the form supplies {value,label} pairs
  min?: number;
}

export const CONFIG_FIELDS: FieldMeta[] = [
  // 1. Pipeline Limits Section
  {
    key: 'limits.max_retries_per_task',
    label: 'Max Retries per Task',
    tooltip:
      'How many times a failed task can be retried before halting.',
    section: 'limits',
    controlType: 'number',
    min: 0,
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

  // 12. Ambient Awareness Section
  {
    key: 'ambient_awareness.verbosity',
    label: 'Verbosity Level',
    tooltip:
      "Controls how much the session-start banner shows. 'verbose' = full banner every session, " +
      "'minimal' = one line carrying the header — project, and portfolio when there is one " +
      "(default), 'silent' = no visible banner (the agent still loads full context), 'off' = no " +
      "ambient context loaded at session start at all.",
    section: 'ambient-awareness',
    controlType: 'toggle-group',
    options: ['verbose', 'minimal', 'silent', 'off'],
  },

  // 13. Telemetry Section
  {
    key: 'telemetry.enabled',
    label: 'Enabled',
    tooltip: 'Capture neutral, non-attributed usage telemetry for harness sessions. Off by default; turning it on is opt-in.',
    section: 'telemetry',
    controlType: 'switch',
  },

  // 14. Dashboard Section
  {
    key: 'ui.port',
    label: 'UI Port',
    tooltip: 'Port the production dashboard listens on when launched via /rad-ui-start (default 1337). Restart the dashboard — /rad-ui-stop then /rad-ui-start — for a change to take effect.',
    section: 'ui',
    controlType: 'number',
    min: 1,
  },

  // 15–16. Communication Style Section
  {
    key: 'communication_style.enabled',
    label: 'Enabled',
    tooltip: 'Apply the selected communication style to agent sessions.',
    section: 'communication-style',
    controlType: 'switch',
  },
  {
    key: 'communication_style.selected',
    label: 'Style',
    tooltip: 'The active communication style. Use /rad-communication to create and edit styles.',
    section: 'communication-style',
    controlType: 'select',
    optionsSource: 'communication-styles',
  },
];

export const CONFIG_FIELD_MAP: Record<string, FieldMeta> =
  CONFIG_FIELDS.reduce<Record<string, FieldMeta>>((map, field) => {
    map[field.key] = field;
    return map;
  }, {});
