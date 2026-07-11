# Coding-Agent Performance — Plan-to-Code A/B (Detailed)

**Coder-subagent telemetry · Old handoff vs. New handoff · 6 paired runs**
Generated 2026-07-10 · Source: `~/.radorc/telemetry` — `.saved-sessions.json` joined to per-session `transcripts/<id>/index.json` (subagent node only)

---

## TL;DR

Reworking how the coding agent receives its task — a **compile-complete handoff** plus **new skills** — cut the coder's work sharply and consistently:

| | Old avg | New avg | Improvement |
|---|--:|--:|--:|
| Cost per run (list price) | **$11.31** | **$6.98** | **−38%** |
| File reads | 44.0 | 21.8 | **−50%** |
| Total tokens | 18.58 M | 10.38 M | **−44%** |
| Cache-read tokens | 17.68 M | 9.81 M | **−45%** |
| Run time | 16.84 min | 14.22 min | **−16%** |
| Tool errors (6-run total) | 4 | 3 | flat |

**Every one of the 6 runs improved. Cost reductions ranged from −29% (worst) to −52% (best); reads fell 43–58% across the board.**

---

## What the coding task builds

Every run — Old and New — implements the **same fixed, complex task from a self-contained handoff**: a backend **HTTP API over a workflow execution engine** (the work is modeled as a directed task graph, or DAG). At a high level, the API lets a client create a project's execution graph, read its state, drive it forward, and steer it as it runs — shipped with a passing test suite. The task is identical across all 12 runs; only the planning + coding instructions differ between the two arms.

---

## Method (how to trust these numbers)

- **We measured the coder *subagent*, not the whole session.** Each plan-to-code run spawns one coder subagent; we read that subagent's isolated node from `index.json` (its own tokens, tool calls, wall-clock) and ignored the orchestrator around it.
- **6 Old (original handoff) vs 6 New (improved handoff), paired 1:1.**
- **Paired by model — identical mix in both arms**, so improvements can't be a model-mix artifact:
  - Runs **1–2** → **Claude Opus 4.8**
  - Runs **3–6** → **Claude Sonnet 5**
- **Dollar cost is priced on the model each subagent actually ran** (list rates): Opus 4.8 $5 in / $25 out; Sonnet 5 $3 in / $15 out; cache-read 0.1×, cache-write 1.25× (5-min TTL). *Note: the session record labels all 12 as Opus — only the subagent transcript reveals the true per-run model. Pricing on the wrong model would have distorted this.*

---

## Spotlight — strongest run (Pair 6, Sonnet 5)

The best-case run is where the new handoff paid off hardest:

| Metric | Old | New | Improvement |
|---|--:|--:|--:|
| Cost | $10.42 | $4.98 | **−52.2%** |
| File reads | 48 | 20 | **−58.3%** |
| Total tokens | 22.01 M | 9.97 M | **−54.7%** |
| Cache-read tokens | 21.22 M | 9.61 M | **−54.7%** |
| Run time | 18.2 min | 13.6 min | −25.6% |

This is a coding task done for **less than half the cost, in three-quarters the time, doing under half the reading** — same model, only the handoff changed.

## Spotlight — smallest gain (Pair 2, Opus 4.8) — shown for honesty

Not every run swings 50%. The weakest pair still improved clearly, but run time was flat:

| Metric | Old | New | Improvement |
|---|--:|--:|--:|
| Cost | $13.53 | $9.67 | −28.6% |
| File reads | 38 | 21 | −44.7% |
| Cache-read tokens | 15.16 M | 9.52 M | −37.2% |
| Run time | 15.5 min | 15.5 min | ~0% |

Even the floor of the range is a **−29% cost / −45% reads** improvement — the intervention never backfired on any run.

---

## Per-run pair analysis (the honest, run-by-run view)

Each row pairs Old-run-N with New-run-N (same model). Percentages are the New improvement over Old.

| Pair | Model | Cost | Reads | Total tokens | Cache-read | Run time |
|:--:|---|--:|--:|--:|--:|--:|
| 1 | Opus 4.8 | −38.5% | −54.1% | **−62.9%** | −66.7% | −26.3% |
| 2 | Opus 4.8 | **−28.6%** ◂ smallest | −44.7% | −37.2% | −38.2% | −0.1% ◂ flat |
| 3 | Sonnet 5 | −42.1% | −47.8% | −40.7% | −40.2% | −26.8% |
| 4 | Sonnet 5 | −35.6% | −54.2% | −29.0% | −27.7% | −4.1% |
| 5 | Sonnet 5 | −35.8% | −42.6% | −41.8% | −42.0% | −9.0% |
| 6 | Sonnet 5 | **−52.2%** ◂ best | **−58.3%** | −54.7% | −54.7% | −25.6% |

**Spread:** cost improvement ranged −28.6% → −52.2% (median −37%). Reads improved in a tight −43% → −58% band — the reduced-reading effect is the most consistent signal in the dataset.

---

## Both model tiers improve independently

| Cohort | Reads | Cache-read tokens | Cost/run |
|---|--:|--:|--:|
| **Opus 4.8** (runs 1–2) | 37.5 → 19.0 (−49%) | 14.57 M → 6.89 M (−53%) | $13.36 → $8.89 (−34%) |
| **Sonnet 5** (runs 3–6) | 47.3 → 23.3 (−51%) | 19.24 M → 11.27 M (−41%) | $10.29 → $6.03 (−41%) |

---

## Cost analysis

**Per-run, list pricing:** $11.31 → $6.98 → **$4.33 saved per coding task (−38%)**.

**Projected at volume** (same model mix, list pricing):

| Coder runs | Old | New | Saved |
|---|--:|--:|--:|
| 100 | $1,131 | $698 | $433 |
| 1,000 | $11,312 | $6,984 | **$4,328** |
| 10,000 | $113,119 | $69,838 | **$43,281** |

**Why cost tracks cache-read — even though it's the cheapest rate.** Cache-read bills at 0.1× the input rate, yet it's the *single biggest line* on the coder's bill, because volume swamps rate. In an agentic loop every turn re-sends the entire conversation so far (prompt + all prior messages + every file read + every tool result) at the cache-read rate, so cache-read tokens ≈ context size × number of turns. One Old run (Run 6, Sonnet 5) shows it:

| Component | Rate | Cost | Share of run |
|---|---|--:|--:|
| **Cache-read** | **$0.30/M** | **$6.37** | **61%** |
| Cache-write | $3.75/M | $2.59 | 25% |
| Output | $15/M | $1.47 | 14% |

Across all 6 runs, cache-read is **~55% of the Old bill**, and **66% of the $25.97 saved comes from cutting it** (cache-write 26%, output 7%). Fewer reads → smaller context replayed each turn *and* fewer turns → cache-read collapses. Note dollar cost fell −38% while cache-read *tokens* fell −45%: the gap is because **output — the code actually written — fell only −20%**. That's the same work with less rummaging, not less work.

---

## What changed, and why it works

1. **Compile-complete handoff** — the task now ships the external surface / contracts inline, so the coder doesn't reopen engine files to re-derive them. **Reads: ~44 → ~22 per run.**
2. **New skills** — tell the coder to work from the handoff and read only what's necessary. Fewer reads → smaller transcript → fewer cache-read tokens replayed each turn → lower cost and shorter runs.
3. **The work itself is preserved.** Output tokens fell only −20% (vs −44% on total tokens) and tool-error counts are flat — the agent does the **same job with far less rummaging**, not a smaller job.

---

## Caveats (read before quoting)

- **n = 6 per arm.** Direction is strong and unanimous across every run and both models, but this is a small paired sample, not a large-N study.
- **Cost is modeled** from token counts × list price, not billed invoices. Cache-write assumed 5-min TTL (1.25×); if any run used 1-hour cache, that cost is understated equally in both arms and nets out of the %.
- **Sonnet 5 intro pricing** ($2/$10 through 2026-08-31) was live during these runs. Under intro rates totals are Old **$54.16** → New **$33.86** (−37.5%) — the percentage barely moves; list pricing is used above as the durable figure.
- **"Errors" = tool-call errors** (a smoothness proxy), not a correctness verdict. Functional correctness was validated in the separate coder-review pass — cite that artifact for pass/fail.
- **Pairs are matched by run number + model.** Confirm each numbered pair is the same underlying task before making a strict per-task claim.

---

## Appendix — session IDs

Old: `35f4bc84` · `52362592` · `fb9f5df5` · `36fb132e` · `051523ae` · `2b1fab6d`
New: `d2f18431` · `f3e2e002` · `7fbe3570` · `a8f7acd5` · `1e40942c` · `1958062b`
