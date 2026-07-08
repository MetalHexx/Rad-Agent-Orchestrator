# Subagent Token Cost — Investigation Report

**Session:** `e0cec539-94f7-4e0b-9d2a-451f1cf611ca`
**Project:** STEERABLE-DAG-1 (execution pipeline, Phases 1–2 of 5)
**Date:** 2026-07-08
**Trigger:** "This run is expensive — subagents are burning tokens. Find the pattern."
**Data:** `~/.radorc/telemetry/{usage,transcripts,checkpoints}/…e0cec539…`

---

## TL;DR

The run cost **$14.08** across **9 agents / 328 requests** for 5 real TypeScript-engine tasks + a phase review + one corrective cycle. That is **~$2.80/task — not bloat.** Cost is **flat across agents** (~$1.1–2.1 each); there is no runaway subagent.

The dominant cost is **cache-read (49%)**, and cache-read is a direct product of **multi-turn context accumulation within each agent's run** — not big outputs (20%), not fat handoffs (they average 1.4K tokens), not the orchestrator (it's Sonnet, $1.74), and not redundant environment setup (1 install all session).

The one genuine anomaly was a **complexity-classifier misfire** that launched a task on Opus (5× price); it was caught and killed within a minute (~$1.45). The only durable, skill-level lever is that **`rad-execute-coding-task` gives agents no context-economy guidance** — worth ~10–20%, not a crisis.

> ⚠️ **Caveat on the filename.** This started as a "subagent bloat" investigation. The evidence did not support "bloat." This report keeps the corrected conclusion, not the initial hypothesis. A first-pass analysis (see [Appendix A](#appendix-a--corrections-log)) reached a **~$45** figure and several wrong conclusions by trusting a derived telemetry field over the billing meter; those are documented and retracted here.

---

## 1. Headline numbers

| Metric | Value |
|---|---|
| **Total cost (billing meter, per-request-model pricing)** | **$14.08** |
| Requests | 328 (42 main-agent, 286 subagent) |
| Agents | 9 (7 coders inc. 1 corrective, 1 reviewer, 1 orchestrator) — plus 1 killed misfire |
| Models | Sonnet 5 (316 req) + Opus 4.8 (12 req) |
| Wall clock | ~76 min |
| Scope covered | 5 of 14 tasks (Phases 1–2); run stopped early for compaction |

**Cost by token category** (correct per-model pricing):

| Category | Cost | Share |
|---|--:|--:|
| Cache-read | $6.94 | 49% |
| Cache-write | $4.03 | 29% |
| Output | $2.81 | 20% |
| Input | $0.30 | 2% |

**Per-request cache-read:** median **70K**, p90 100K, max 145K, mean 67K. Output per request: median **223 tokens**. Every request drags a large cached context; almost none produce large output.

---

## 2. Per-agent cost (authoritative)

Meter rows attributed to agents via `requestId` (every telemetry event carries the API `requestId`; the billing meter keys on the same id). Totals reconcile to the meter exactly.

| $ | reqs | cache-read | agent |
|--:|--:|--:|---|
| 2.14 | 39 | 3.5M | coder · P02-T01 (Sonnet redo) |
| 1.87 | 39 | 2.8M | coder · P01-T03 |
| **1.74** | 42 | 2.8M | **orchestrator (main) · Sonnet xHigh** (+1 Opus launch blip) |
| 1.59 | 39 | 2.9M | coder · P02-T02 |
| 1.45 | 11 | 0.3M | coder-senior · P02-T01 — **Opus misfire, killed** |
| 1.44 | 38 | 2.1M | reviewer · Phase 1 (cumulative diff) |
| 1.42 | 41 | 2.9M | coder · P01-T02 |
| 1.31 | 42 | 2.5M | coder · Phase 1 corrective |
| 1.11 | 37 | 2.0M | coder · P01-T01 |
| **14.08** | **328** | **22.0M** | |

**Read this table as: cost is uniform.** Nine agents each doing ~40 turns of real implement-build-test work land within a 2× band of one another. The Opus misfire is the only outlier on **cost-per-request** — 11 requests in one minute cost as much as a full 40-turn Sonnet task, because Opus cache-read is 5× Sonnet's.

---

## 3. The cost mechanism

### 3.1 Cache-read economics

Cache-read dominates because of **volume, not unit price** — it is the *cheapest* token class ($0.30/M Sonnet vs $3 input / $15 output). Caching is doing its job: billed uncached, this same work (22.0M cache-read + 0.87M cache-write re-billed as input) would have cost **~$70 — roughly 5× more**. The lever is not "cache more"; it is "carry less context per turn, and take fewer turns."

### 3.2 Within-run accumulation is the driver

Each coder runs **one ~40-turn agentic loop** — a single growing conversation. Every API request re-sends the entire prior transcript (system prompt + handoff + every earlier tool call and result), served from cache and billed as **cache-read**. So a file read on turn 5 is **not paid once** — its contents sit in the conversation and are re-sent on turns 6–40.

The consequence: **reading a file once is enough to make it a recurring per-turn cost for the rest of that agent's life.** With ~20 distinct file reads + builds + tests accumulating over ~40 turns, each agent's context climbs to 80–145K and the integral of that curve is the 2–3.5M cache-read we see per agent. Fixed base at spawn is only ~12–15K tokens — everything above that is accumulated working context.

This is why **55% of all cache-read comes from turns already carrying ≥80K context** — the money is spent in the back half of each agent's run.

---

## 4. "Stateless subagents" — what "carrying context forward" means

Subagents **are** stateless *across spawns* — a fresh coder has no memory of a prior one. The accumulation above is entirely **within a single spawn's turn loop**, not memory across spawns. Three distinct effects, all real, in priority order:

1. **Within-run accumulation (primary).** As in §3.2 — even single reads persist in-context and are re-billed every subsequent turn of that one agent.
2. **Genuine re-reads (secondary, modest).** Most reads are distinct (e.g. 22 reads / 22 distinct files), but there are repeats:
   - **`AGENTS.md` re-read 2–3× by nearly every agent** (the skill directs consulting the nearest `AGENTS.md`) — systemic.
   - Scattered source/config repeats: one coder read `index.ts` **5×** and `types.ts` 3×; `package.json` 4× in the scaffold task; the reviewer read `tsconfig.json` 3×; a corrective read a test file 4×.
   Re-reading a file already resident is pure duplicate cost — you pay to read it again *and* it was already inflating every turn.
3. **Cross-spawn cold re-reads (inherent).** Because agents are stateless, each of the 9 independently cold-reads the same foundational files — `AGENTS.md`, `package.json`, `tsconfig`, shared `index.ts`. The same handful of files is re-discovered ~9× across the session. Not "carried forward" (it can't be) — re-paid per spawn.

---

## 5. Genuine findings (ranked)

1. **No context-economy discipline in the coder skill.** Agents accumulate ~20 distinct reads and re-read `AGENTS.md`/configs 2–3× with no guidance to read narrowly or avoid re-reading resident files. This is the only durable, skill-level lever. **~10–20% of cache-read.**
2. **Cross-agent redundancy on foundational files.** Nine stateless agents each cold-read the same `AGENTS.md` + configs. Addressable by injecting a small conventions digest into the spawn prompt.
3. **Complexity-classifier misfire → Opus.** P02-T01 first launched on `coder-senior`/Opus (5× price), was killed after 11 requests / 0 files, and redone on Sonnet. Cost ~$1.45 for zero output. Already caught operationally; the durable fix is the classifier, not the run.

---

## 6. What is NOT the problem (myth-busting)

Each of these was a plausible suspect; the evidence cleared it:

| Suspected cause | Verdict | Evidence |
|---|---|---|
| Bloated task handoffs | **No** | Handoffs average **1,436 tokens** (max 2,739). Agents correctly do *not* read the 18K master-plan / 14K requirements. |
| Orchestrator on Opus | **No** | Main is **Sonnet xHigh**: 41 Sonnet + 1 Opus request (the launch blip). Main cost $1.74. |
| Every agent re-runs `npm install` / builds | **No** | Across the whole session: **1 install**, 16 builds, 15 test runs. No per-agent hydration tax. |
| Review loop doubles the phase | **No** | A **phase** review is *one* pass over the cumulative phase diff + one corrective = **$2.75 (~20%)** for three tasks' combined work. The reviewer's 29 Bash / 30 reads are required by its "run it yourself" evidence standard, not waste. |
| The usage meter under-reports cost | **No** | Meter and transcripts share the **exact same 328 `requestId`s** (zero missing either way). The meter is complete; the dashboard built on it is authoritative. |
| A runaway subagent | **No** | Cost is flat: every agent is $1.1–2.1. |

---

## 7. Skill assessment — `rad-execute-coding-task`

The skill is sound on **code quality** (YAGNI, scope discipline, minimal diffs, honest testing). Its only cost-relevant gap is the **absence of any context-economy guidance**. It never tells the agent to:

- read narrowly (`offset`/`limit`, grep-to-locate before full reads);
- **not re-read a file already in context** (kills the `AGENTS.md` 2–3× and `index.ts` 5× patterns);
- pipe noisy commands (`tsc`, `vitest`, install) through a tail/summary so only failures land in context.

Everything else the skill prescribes — reading the handoff end-to-end (cheap: 1.4K), environment self-sufficiency, run-real-tests — is either negligible or a deliberate correctness trade-off, **not** a cost problem. The earlier draft's "environment self-sufficiency tax" claim is **retracted** (data: 1 install all session).

---

## 8. Recommendations

Ranked by leverage. Expected savings are modest because the run is already reasonable — these matter **at scale** (many projects × many agents), not for any single run.

1. **Add a "Context economy" section to `rad-execute-coding-task`.** Narrow reads; never re-read a resident file; tail/summarize noisy command output; batch independent reads in one turn. *Est. 10–20% of cache-read.*
2. **Inject a repo-conventions digest into coder/reviewer spawn prompts** (AGENTS.md essentials + config summary) so 9 stateless agents don't each cold-read the same foundational files. Trades a little prompt size for fewer read-turns.
3. **Harden the complexity classifier** so tasks don't misfire onto Opus. This is the only thing that spiked cost-*per-request* in this run.
4. **Leave the review loop alone.** Its cost is deliberate and load-bearing for trust; cutting the reviewer's own build/test runs would trade away the thing that makes a review worth having.

**Do not** over-optimize this pipeline on the strength of one $14 run. The highest-value action is #3 (misfire prevention); #1–2 are cheap hygiene wins worth doing once.

---

## Appendix A — Corrections log

The first-pass analysis reached **~$45** and several wrong conclusions. All stemmed from trusting the transcripts' derived `tokens` aggregate over the per-request billing meter. Recorded here so the error mode is not repeated.

| Claim (first pass) | Corrected | Root cause of the error |
|---|---|---|
| Total ≈ **$45**, 48M cache-read | **$14.08**, 22M cache-read | Transcript `tokens.cacheRead` spreads one request's tokens across its several events (709 event-refs over 328 real requests), inflating the sum. Ratios vs meter were inconsistent (out 1.9×, cache-read 2.2×, cache-write 3.0×) — proof it is not a clean per-request measure. |
| Orchestrator runs on **Opus**, ~$13 | **Sonnet xHigh**, $1.74 | Priced the agent by `model[0]`; main's model *list* contained Opus (the 1 blip), so all its cache-read was mispriced at Opus rates. |
| **The usage meter under-reports by ~50%** | Meter is **complete and correct** | `requestId` reconciliation: 328 in meter ∩ 328 in transcripts, 0 missing either side. Should have anchored to the meter from the start. |
| **Review doubles the phase** | One cumulative pass + one corrective = **~20%** | Misunderstood phase-review scope; confirmed against `rad-code-review` (phase = cumulative diff, single review). |
| Every coder re-hydrates the worktree (**install/build tax**) | **1 install** all session | Inferred from Bash *counts* without inspecting Bash *commands*. |

**Lesson:** for cost, the **billing meter is the single source of truth**. Derived/aggregated telemetry fields (`transcript.tokens`) are fine for *relative* correlation (tool counts, turn counts, file lists) but must not be used for absolute dollars.

---

## Appendix B — Reproduce this analysis

```
# Source of truth — one row per API request, per-request model:
~/.radorc/telemetry/usage/usage-2026-07-08-e0cec539-….ndjson
  fields: model, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens,
          source (main-agent|subagent), pointers.requestId

# Per-agent correlation (labels, tools, file reads, per-event requestId):
~/.radorc/telemetry/transcripts/e0cec539-…/{agent-*.json, main.json}
  events[].requestId  ← join key back to the meter for per-agent attribution

# Pricing per Mtok used here:
#   Sonnet 5 : in 3    / out 15 / cache-write 3.75  / cache-read 0.30
#   Opus 4.8 : in 15   / out 75 / cache-write 18.75 / cache-read 1.50
```

Per-agent dollars: build `requestId → agent` from transcript events, then sum `cost(row)` over meter rows grouped by that map. Totals must reconcile to the meter ($14.08); if they don't, the join is incomplete.
