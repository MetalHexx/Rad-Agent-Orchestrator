import type { SavedSessionSnapshot } from "@rad-orchestration/telemetry";

export type MetricDirection = "lower-better" | "neutral";
export interface Delta { pct: number | null; improved: boolean | null; }

/** Baseline-relative delta. For lower-better, a fall (negative pct) is the improvement. (DD-7) */
export function computeDelta(baseline: number, candidate: number, direction: MetricDirection): Delta {
  if (direction === "neutral") return { pct: null, improved: null };
  if (baseline === 0) return candidate === 0 ? { pct: 0, improved: null } : { pct: null, improved: false };
  const pct = (candidate - baseline) / baseline;
  return { pct, improved: pct === 0 ? null : pct < 0 };
}

export interface MetricSpec { key: string; label: string; direction: MetricDirection; get: (s: SavedSessionSnapshot) => number | string | null; }
/** Every captured metric, in report order. Spend/duration/tools/tokens are lower-better; model is neutral. (DD-6, DD-7) */
export const METRICS: MetricSpec[] = [
  { key: "totalSpend", label: "Total Spend", direction: "lower-better", get: (s) => s.totalSpend },
  { key: "durationMs", label: "Duration", direction: "lower-better", get: (s) => s.durationMs },
  { key: "toolCalls", label: "Tool Calls", direction: "lower-better", get: (s) => s.toolCalls },
  { key: "toolErrors", label: "Tool Errors", direction: "lower-better", get: (s) => s.toolErrors },
  { key: "subagents", label: "Subagents", direction: "lower-better", get: (s) => s.subagents },
  { key: "filesTouched", label: "Files Touched", direction: "lower-better", get: (s) => s.filesTouched },
  { key: "input", label: "Input Tokens", direction: "lower-better", get: (s) => s.tokens.input },
  { key: "output", label: "Output Tokens", direction: "lower-better", get: (s) => s.tokens.output },
  { key: "cacheRead", label: "Cache Read", direction: "lower-better", get: (s) => s.tokens.cacheRead },
  { key: "cacheCreation", label: "Cache Creation", direction: "lower-better", get: (s) => s.tokens.cacheCreation },
  { key: "model", label: "Model", direction: "neutral", get: (s) => s.model },
];
