import type {
  OrchestrationConfig,
  ConfigValidationErrors,
} from '@/types/config';

const VALID_EXECUTION_MODE: readonly string[] = ['ask', 'phase', 'task', 'autonomous'];
const VALID_SOURCE_CONTROL_ACTION: readonly string[] = ['always', 'ask', 'never'];

function isSection(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateConfig(config: OrchestrationConfig): ConfigValidationErrors {
  const errors: ConfigValidationErrors = {};

  // 1. limits — integer constraint
  if (!isSection(config.limits)) {
    errors['limits'] = 'Missing limits section';
  } else {
    if (!Number.isInteger(config.limits.max_retries_per_task) || (config.limits.max_retries_per_task as number) < 0) {
      errors['limits.max_retries_per_task'] = 'Must be 0 or a positive integer';
    }
  }

  // 5–7. human_gates
  if (!isSection(config.human_gates)) {
    errors['human_gates'] = 'Missing human_gates section';
  } else {
    if (typeof config.human_gates.after_planning !== 'boolean') {
      errors['human_gates.after_planning'] = 'Must be true or false';
    }
    if (!VALID_EXECUTION_MODE.includes(config.human_gates.execution_mode as string)) {
      errors['human_gates.execution_mode'] = 'Invalid execution mode';
    }
    if (typeof config.human_gates.after_final_review !== 'boolean') {
      errors['human_gates.after_final_review'] = 'Must be true or false';
    }
  }

  // 8–9. source_control
  if (!isSection(config.source_control)) {
    errors['source_control'] = 'Missing source_control section';
  } else {
    if (!VALID_SOURCE_CONTROL_ACTION.includes(config.source_control.auto_commit as string)) {
      errors['source_control.auto_commit'] = 'Invalid auto commit setting';
    }
    if (!VALID_SOURCE_CONTROL_ACTION.includes(config.source_control.auto_pr as string)) {
      errors['source_control.auto_pr'] = 'Invalid auto PR setting';
    }
  }

  // 10. telemetry (optional section)
  if (config.telemetry !== undefined) {
    if (!isSection(config.telemetry) || typeof config.telemetry.enabled !== 'boolean') {
      errors['telemetry.enabled'] = 'Must be true or false';
    }
  }

  return errors;
}
