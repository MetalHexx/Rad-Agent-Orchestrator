import type { SessionAgg } from "./sessions";

/** Distinct subagents in a session: unique agentId among rows with source==='subagent'.
 *  Subagent rows missing agentId are uncounted; a pure main-agent session reads 0 (FR-3, NFR-2). */
export function countSubagents(session: SessionAgg): number {
  const ids = new Set<string>();
  for (const r of session.rows) {
    if (r.source === "subagent" && r.agentId != null) ids.add(r.agentId);
  }
  return ids.size;
}
