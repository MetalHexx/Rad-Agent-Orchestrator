import type { ObservabilityUsageRow } from '@rad-orchestration/telemetry';
import { effectiveTokens } from '@/lib/observability/effective-tokens';
import { normalizeModel } from '@/lib/observability/model-color';

// Pure, O(rows), memoizable transform — the reuse seam (AD-2, NFR-1). Accepts ANY row set
// (one session's or all sessions') so the same AgentTree mounts on either surface.

export interface SpendSegment { model: string; tokens: number; }

export interface AgentTreeNode {
  key: string;                       // STABLE: 'main' | agentType | agentId (NFR-7, FR-9)
  kind: 'main' | 'group' | 'run';
  label: string;                     // 'main-agent' | 'coder' | 'coder 1'
  agentType?: string;
  runCount: number;
  tokens: number;                    // effectiveTokens sum (AD-3)
  models: SpendSegment[];            // model split, sorted desc
  reqs: number;
  firstMs: number;
  lastMs: number;
  runs?: AgentTreeNode[];
}

export interface SubagentTree {
  windowTotal: number;               // == Total Spend card by construction (FR-4, AD-6)
  main: AgentTreeNode;
  subagents: AgentTreeNode[];        // groups, sorted by first activity (execution order)
  subagentTotal: number;
  subagentPct: number;
}

interface Acc { tokens: number; reqs: number; firstMs: number; lastMs: number; models: Map<string, number>; }
const emptyAcc = (): Acc => ({ tokens: 0, reqs: 0, firstMs: Infinity, lastMs: -Infinity, models: new Map() });
const finiteOrZero = (n: number): number => (Number.isFinite(n) ? n : 0);
// Sort key for execution order: a 0 firstMs (no parseable timestamp) sinks to the end.
const activityRank = (firstMs: number): number => (firstMs > 0 ? firstMs : Number.MAX_SAFE_INTEGER);

function addRow(acc: Acc, row: ObservabilityUsageRow): void {
  const t = effectiveTokens(row);
  acc.tokens += t;
  acc.reqs += 1;
  const ms = Date.parse(row.timestamp);
  if (Number.isFinite(ms)) { acc.firstMs = Math.min(acc.firstMs, ms); acc.lastMs = Math.max(acc.lastMs, ms); }
  const m = normalizeModel(row.model);
  acc.models.set(m, (acc.models.get(m) ?? 0) + t);
}

function segments(acc: Acc): SpendSegment[] {
  return [...acc.models.entries()]
    .map(([model, tokens]) => ({ model, tokens }))
    .sort((a, b) => b.tokens - a.tokens);
}

export function buildSubagentTree(rows: ObservabilityUsageRow[]): SubagentTree {
  const mainAcc = emptyAcc();
  interface Group { type: string; acc: Acc; runs: Map<string, Acc>; runOrder: string[]; }
  const groups = new Map<string, Group>();
  const groupOrder: string[] = [];

  for (const r of rows) {
    if (r.source === 'main-agent') { addRow(mainAcc, r); continue; }
    const type = r.agentType ?? '(unattributed)';
    let g = groups.get(type);
    if (!g) { g = { type, acc: emptyAcc(), runs: new Map(), runOrder: [] }; groups.set(type, g); groupOrder.push(type); }
    addRow(g.acc, r);
    const runId = r.agentId ?? '(unkeyed)';
    let rAcc = g.runs.get(runId);
    if (!rAcc) { rAcc = emptyAcc(); g.runs.set(runId, rAcc); g.runOrder.push(runId); }
    addRow(rAcc, r);
  }

  const main: AgentTreeNode = {
    key: 'main', kind: 'main', label: 'main-agent', runCount: 1,
    tokens: mainAcc.tokens, models: segments(mainAcc), reqs: mainAcc.reqs,
    firstMs: finiteOrZero(mainAcc.firstMs), lastMs: finiteOrZero(mainAcc.lastMs),
  };

  const subagents: AgentTreeNode[] = groupOrder.map((type) => {
    const g = groups.get(type)!;
    const runs: AgentTreeNode[] = g.runOrder.map((runId, i) => {
      const a = g.runs.get(runId)!;
      return {
        key: runId === '(unkeyed)' ? `${type}#unkeyed-${i}` : runId,
        kind: 'run' as const,
        label: '',                          // numbered after the activity sort below (FR-3)
        agentType: type, runCount: 1,
        tokens: a.tokens, models: segments(a), reqs: a.reqs,
        firstMs: finiteOrZero(a.firstMs), lastMs: finiteOrZero(a.lastMs),
      };
    }).sort((a, b) => activityRank(a.firstMs) - activityRank(b.firstMs));   // execution order (first activity)
    runs.forEach((r, i) => { r.label = `${type} ${i + 1}`; });             // number follows activity order
    return {
      key: type, kind: 'group' as const, label: type, agentType: type,
      runCount: g.runOrder.length, tokens: g.acc.tokens, models: segments(g.acc), reqs: g.acc.reqs,
      firstMs: finiteOrZero(g.acc.firstMs), lastMs: finiteOrZero(g.acc.lastMs), runs,
    };
  }).sort((a, b) => activityRank(a.firstMs) - activityRank(b.firstMs));     // execution order (first activity)

  const subagentTotal = subagents.reduce((s, n) => s + n.tokens, 0);
  const windowTotal = main.tokens + subagentTotal;
  const subagentPct = windowTotal > 0 ? subagentTotal / windowTotal : 0;
  return { windowTotal, main, subagents, subagentTotal, subagentPct };
}

/**
 * Reorder current groups to match a previously-frozen key order so rows do not reshuffle
 * mid-turn; keys not in the frozen list (new agents) append in their current (spend) order (NFR-7, FR-9).
 */
export function freezeSubagentOrder(current: AgentTreeNode[], frozenKeys: string[]): AgentTreeNode[] {
  if (frozenKeys.length === 0) return current;
  const byKey = new Map(current.map((n) => [n.key, n]));
  const held = frozenKeys.map((k) => byKey.get(k)).filter((n): n is AgentTreeNode => !!n);
  const seen = new Set(frozenKeys);
  const appended = current.filter((n) => !seen.has(n.key));
  return [...held, ...appended];
}
