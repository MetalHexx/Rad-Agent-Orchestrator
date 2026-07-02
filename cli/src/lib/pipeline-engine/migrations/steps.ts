import { Ajv } from 'ajv';
import v5Schema from '../schemas/legacy/orchestration-state-v5.schema.json' with { type: 'json' };
import { CURRENT_SCHEMA_VERSION } from './version.js';

export interface MigrationStep {
  from: string;
  to: string;
  migrate: (s: unknown) => unknown;
}

const v5Validate = new Ajv({ allErrors: true }).compile(v5Schema as object);

function wrapEntry(e: Record<string, unknown>): void {
  const hash = (e['commit_hash'] ?? null) as string | null;
  delete e['commit_hash'];
  e['repos'] = [{ name: '', commit_hash: hash }];
}

export function migrateV5ToV6(input: unknown): { $schema: string } & Record<string, unknown> {
  if (!v5Validate(input)) {
    throw new Error('migrate v5→v6: input does not validate against the archived v5 schema');
  }
  const s = structuredClone(input) as Record<string, unknown>;
  // Drop the retired limits: v6 config.limits no longer carries max_phases /
  // max_tasks_per_phase (retired plan-size caps) nor max_consecutive_review_
  // rejections (PO-4 — corrective birth is gated solely by max_retries_per_task),
  // and the v6 schema rejects them under additionalProperties:false.
  const config = s['config'] as Record<string, unknown> | undefined;
  const limits = config?.['limits'] as Record<string, unknown> | undefined;
  if (limits) {
    delete limits['max_phases'];
    delete limits['max_tasks_per_phase'];
    delete limits['max_consecutive_review_rejections'];
  }
  const graph = s['graph'] as Record<string, unknown> | undefined;
  const nodes = graph?.['nodes'] as Record<string, unknown> | undefined;
  const phaseLoop = nodes?.['phase_loop'] as Record<string, unknown> | undefined;
  const phaseIters = (phaseLoop?.['iterations'] ?? []) as Record<string, unknown>[];
  for (const phaseIter of phaseIters) {
    wrapEntry(phaseIter);
    for (const ct of (phaseIter['corrective_tasks'] ?? []) as Record<string, unknown>[]) {
      wrapEntry(ct);
    }
    const taskNodes = phaseIter['nodes'] as Record<string, unknown> | undefined;
    const taskLoop = taskNodes?.['task_loop'] as Record<string, unknown> | undefined;
    const taskIters = (taskLoop?.['iterations'] ?? []) as Record<string, unknown>[];
    for (const taskIter of taskIters) {
      wrapEntry(taskIter);
      for (const ct of (taskIter['corrective_tasks'] ?? []) as Record<string, unknown>[]) {
        wrapEntry(ct);
      }
    }
  }
  s['$schema'] = CURRENT_SCHEMA_VERSION;
  return s as { $schema: string } & Record<string, unknown>;
}

export const MIGRATION_LADDER: MigrationStep[] = [
  { from: 'orchestration-state-v5', to: 'orchestration-state-v6', migrate: migrateV5ToV6 },
];
