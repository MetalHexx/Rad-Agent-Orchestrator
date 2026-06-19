import { isActive } from '@/lib/observability/activity-dot-color';
import type { SessionAgg } from '@/lib/observability/sessions';

/** Active-now over a system-wide session set (today-inclusive), independent of the analyzed window. */
export function countActiveNow(systemSessions: SessionAgg[], nowMs: number): number {
  return systemSessions.filter((s) => isActive(nowMs - s.lastMs)).length;
}
