# Token Spend & Cost Accounting — Anthropic Pricing, Effective Tokens, and Validation

> **Type:** Research / reference. Evergreen.
> **Scope:** How Anthropic **accounts** and **prices** tokens (the `usage` object, the four token classes, prompt-cache semantics, the per-model rate tables and their ratios), how rad-orc's telemetry turns that raw usage into the dashboard's **"effective tokens"** spend metric, and the read-only **three-way reconciliation** methodology that proves the chain *raw Claude Code transcript → our NDJSON store → `effectiveTokens`* is faithful end-to-end. Answers the operational question: *can the dashboard number be reconciled to Anthropic's published pricing, and where does it not?*
> **Compiled:** 2026-06-20 from a multi-agent research pass against `platform.claude.com/docs` (pricing; prompt-caching) and `code.claude.com/docs` (statusline; costs), corroborated against this repo's `lib/telemetry` source and a **first-party reconciliation audit** of a real 1,149-request session (§7). Pricing numbers are time-sensitive — re-verify §3 against the live pricing page before relying on absolute rates; the **ratios** (§3.2) and **accounting semantics** (§2) are far more stable.
> **Audience:** Anyone building or tuning the observability dashboard's cost/efficiency metrics, wiring a per-model cost view, or reasoning about what a Claude session actually costs.
> **Companion:** [`./claude-code-hooks.md`](./claude-code-hooks.md) — where the raw token data comes from (hooks as trigger + transcript locator; transcript as source of truth).

---

## 1. TL;DR — the contract in six sentences

1. A Claude API response reports tokens in **four mutually-exclusive classes** — `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens` — and the true input is their **sum**, *not* `input_tokens` alone (which counts only tokens after the last cache breakpoint).
2. **Cost is a dot product**: each class × its per-model rate. Across every model the rates hold fixed **ratios to base input** — output **5×**, cache-write-5m **1.25×**, cache-write-1h **2×**, cache-read **0.1×** — so a single "cost-shaped" scalar can be built from those weights.
3. rad-orc's **`effectiveTokens`** is exactly that scalar: `input·1 + output·5 + cacheRead·0.1 + cacheCreation·1.25`. For a **single model** it satisfies the exact identity **`effectiveTokens × base_input_rate = request cost`**.
4. It is **model-agnostic by design** — the weights are relative to *each model's own* base rate — so the *aggregate* effective number for a **mixed-model** session (e.g. Opus main + Sonnet/Haiku subagents) cannot be multiplied by one rate to get dollars. Per-model `$` reconciliation is deferred to the dashboard's **details page**.
5. A first-party audit (§7) proved **capture is exact**: our NDJSON store reproduces the raw transcript to the integer (0 missing / 0 extra / 0 mismatched across 1,149 requests), and dedup is clean at all four layers.
6. **`effective` is not raw and not dollars.** On cache-heavy agentic sessions it runs *well below* the raw token count (≈0.17× in the audit — cache reads dominate and are discounted 10×), and converting it to `$` requires the per-model split. Treat it as a **cost-proportional volume proxy**, reconcile to `$` per model.

---

## 2. How Anthropic accounts tokens

### 2.1 The `usage` object — four classes, mutually exclusive

Every assistant message in a transcript carries `message.usage`:

```jsonc
"usage": {
  "input_tokens": 50,                      // tokens AFTER the last cache breakpoint (fresh, uncached)
  "output_tokens": 1200,                   // generated tokens
  "cache_read_input_tokens": 100000,       // cached prefix reused this call (a cache HIT)
  "cache_creation_input_tokens": 0,        // tokens written INTO the cache this call (a cache WRITE)
  "cache_creation": {                      // optional per-TTL breakdown of the write
    "ephemeral_5m_input_tokens": 0,
    "ephemeral_1h_input_tokens": 0
  },
  "service_tier": "standard"
}
```

**The load-bearing fact:** the three input-side fields are **non-overlapping**. `input_tokens` does **not** already include cached tokens — it is only the tokens past your last cache breakpoint. Therefore:

```
total_input_tokens = input_tokens + cache_creation_input_tokens + cache_read_input_tokens
```

Anthropic's worked example: a request with a 100,000-token cached prefix, no new cache writes, and a 50-token user turn reports `cache_read_input_tokens: 100000`, `cache_creation_input_tokens: 0`, `input_tokens: 50` → **100,050** total input processed. **Implication for any summing code: add the three disjoint fields; never assume `input_tokens` contains the cached ones.** (Conversely, a consumer that *did* assume inclusion and then *also* added cache-read would double-count — the classic over-count bug. rad-orc treats them disjointly; see §6.)

### 2.2 Why cumulative cache-read balloons (and is *correct*)

In a multi-turn agentic loop every turn re-sends the growing context, which is served as `cache_read_input_tokens` on each subsequent call. Across dozens of turns this accumulates into the **tens of millions** — and you genuinely pay for it, at the discounted **0.1×** read rate. A cumulative session token figure that looks "impossibly large" next to the 200k context window is usually this, not a bug. The audited session (§7) is **96% cache reads** for exactly this reason.

---

## 3. Pricing

### 3.1 Per-model rates (USD per **1,000,000** tokens; MTok)

| Model | Input | Output | Cache write 5-min | Cache write 1-hour | Cache read |
|---|--:|--:|--:|--:|--:|
| Claude Opus 4.8 / 4.7 / 4.6 | 5.00 | 25.00 | 6.25 | 10.00 | 0.50 |
| Claude Sonnet 4.6 / 4.5 | 3.00 | 15.00 | 3.75 | 6.00 | 0.30 |
| Claude Haiku 4.5 | 1.00 | 5.00 | 1.25 | 2.00 | 0.10 |
| Claude Fable 5 | 10.00 | 50.00 | 12.50 | 20.00 | 1.00 |
| Opus 4.1 / 4.0 *(deprecated)* | 15.00 | 75.00 | 18.75 | 30.00 | 1.50 |

> Re-verify against the live pricing page before trusting absolute numbers — rates change. The **structure** below is the stable part.

### 3.2 The ratios (identical across all models, relative to that model's base input)

| Class | Multiplier vs base input |
|---|--:|
| Base input | **1.0×** |
| Output | **5.0×** |
| Cache write, 5-minute TTL | **1.25×** |
| Cache write, 1-hour TTL | **2.0×** |
| Cache read (hit) | **0.1×** |

These five multipliers are precisely the weights needed to collapse the four token classes into one "effective input-token" scalar (§5).

### 3.3 Modifiers (stack multiplicatively)

- **`inference_geo: "us"`** (US data residency, Opus 4.6 / Sonnet 4.6 and later): **1.1×** on *all* classes. Default `"global"` is standard price.
- **Batch API:** **0.5×** on input + output.
- **1M-context (`[1m]`) models:** a long-context **premium may apply above a 200k-token input threshold**. The exact multipliers were **not** confirmed in this pass — **verify on the pricing page** if pricing 1M-context sessions; unmodeled, it makes our estimate run *low*, never high.
- **Tokenizer change:** Opus 4.7+ use a new tokenizer that can emit up to ~35% more tokens for the same text. This shifts **counts**, not per-token **rates** — do not compare raw token *volumes* across the 4.6 → 4.7 boundary.

### 3.4 Per-request cost formula

```
request_cost_usd =
    input_tokens                * input_rate
  + cache_creation_5m_tokens    * (1.25 * input_rate)
  + cache_creation_1h_tokens    * (2.00 * input_rate)
  + cache_read_input_tokens     * (0.10 * input_rate)
  + output_tokens               * (5.00 * input_rate)
  [ + server_tool_use, e.g. web search billed per-call ]
  [ * 1.1 if inference_geo = "us" ]   [ * 0.5 if Batch API ]
```

---

## 4. Claude Code's own cost surfaces

- **`cost.total_cost_usd`** (statusline JSON; `/cost`): a **client-side estimate** — Claude Code applies a built-in per-model rate table to each response's `usage` and accumulates. Per the docs it is "computed locally from token counts and may differ from your actual bill" (Anthropic, *Claude Code costs*); the **Console Usage page is authoritative**. It is the same dot-product as §3.4, so our transcript-derived `$` and `total_cost_usd` should agree closely.
- **Statusline token fields are NOT cumulative.** As of Claude Code **v2.1.132**, `context_window.total_input_tokens` / `total_output_tokens` were redefined to mean *current context-window occupancy*, not session totals. There is **no built-in field for cumulative session token spend** — only the `$` estimate and `transcript_path` (which lets a consumer compute totals itself).
- **`transcript_path`** is on every hook/statusline payload — the absolute path to the session `.jsonl`, the source of truth for tokens.

---

## 5. "Effective tokens" — rad-orc's spend metric

Defined in [`../../ui/lib/observability/effective-tokens.ts`](../../ui/lib/observability/effective-tokens.ts):

```ts
effectiveTokens = inputTokens * 1
                + outputTokens * 5
                + cacheReadTokens * 0.1
                + cacheCreationTokens * 1.25
```

The weights are the §3.2 ratios. The key property:

> **For a single model, `effectiveTokens × base_input_rate = request cost`, exactly.**

Proof (Opus 4.8, per-MTok `5 / 25 / 6.25 / 0.5` for input/output/write-5m/read): factor out the `5` → `5 × (1, 5, 1.25, 0.1)`, which are exactly the effective weights. So effective tokens are simply **dollars re-expressed in units of base-input-tokens**.

**Two deliberate consequences:**
1. **Model-agnostic.** One effective token is worth `$5/MTok` of Opus but only `$1/MTok` of Haiku. Summing effective tokens across models yields a valid *volume* proxy but **not** a one-multiply-to-dollars number. Reconciling that — a true per-model `$` figure — is the job of the forthcoming **details page**, not this metric.
2. **Cache-creation TTL is collapsed.** `cacheCreationTokens` is a single field (the store flattens 5m + 1h; §6), weighted `1.25×`. Genuine **1-hour** writes should be `2.0×`, so 1h-cache usage is slightly **under**-weighted (quantified in §7).

`effectiveTokens` is also the per-bucket value summed by the chart and the per-session `spend` accumulator in [`../../ui/lib/observability/sessions.ts`](../../ui/lib/observability/sessions.ts) (`deriveSessions`).

---

## 6. The rad-orc pipeline (capture → store → read → aggregate)

| Stage | File | What it does |
|---|---|---|
| Trigger | [`../../harness-installers/shared/hooks/telemetry-capture.mjs`](../../harness-installers/shared/hooks/telemetry-capture.mjs) | Gated (default-off) hook; on `PostToolUse`/`Stop`/`SessionEnd` spawns the capture CLI with `session_id`, `transcript_path`, subagent identity. |
| Parse | [`../../lib/telemetry/src/adapter/transcript.ts`](../../lib/telemetry/src/adapter/transcript.ts) | Reads `<session>.jsonl` and sibling `…/<session>/subagents/agent-<id>.jsonl` (+ `.meta.json` identity sidecar). |
| Adapt | [`../../lib/telemetry/src/adapter/claude-code-adapter.ts`](../../lib/telemetry/src/adapter/claude-code-adapter.ts) | One `TelemetryRecord` per assistant request; maps `usage.*` → `inputTokens/outputTokens/cacheReadTokens/cacheCreationTokens`; tags `source: main-agent \| subagent`; **skips `isSidechain` lines in the main sweep** (subagent files are read separately). |
| Dedup (capture) | adapter `byKey` + checkpoint `seen` | Keyed by `requestId` (= `usageId`); last line per request wins (handles streaming partials); `seen` skips already-captured requests across invocations. |
| Persist | [`../../lib/telemetry/src/sink/ndjson-sink.ts`](../../lib/telemetry/src/sink/ndjson-sink.ts) | Appends to `<root>/usage/usage-<YYYY-MM-DD>-<sessionId>.ndjson`; `root = $RADORC_TELEMETRY_ROOT ?? ~/.radorc/telemetry`. |
| Read | [`../../lib/telemetry/src/read/usage-reader.ts`](../../lib/telemetry/src/read/usage-reader.ts) | `readUsageForDates` loads the day partitions, **dedups by `sessionId\x00usageId` (last-wins)**. |
| Serve | [`../../ui/app/api/observability/usage/route.ts`](../../ui/app/api/observability/usage/route.ts) | `GET` → `toObservabilityUsageRow`, `cache: no-store`. |
| Merge (live) | `upsertRows` in [`../../ui/lib/observability/sessions.ts`](../../ui/lib/observability/sessions.ts) | SSE appends merged into a `Map` keyed by `sessionId usageId` (last-wins) — overlap with the API fetch collapses, no client double-count. |
| Aggregate | `deriveSessions` (same file) | Groups rows by `sessionId` (subagent rows share the parent `sessionId` so their spend folds in), sums `effectiveTokens`. |

**Dedup is layered four deep, all keyed on `requestId`** (capture `byKey`, checkpoint `seen`, read `sessionId\x00usageId`, client `upsertRows`). A per-request double-count is therefore well-defended — confirmed empirically in §7.

**Known data-fidelity gap:** the store keeps a single flat `cacheCreationTokens`; the per-TTL split (`cache_creation.ephemeral_5m/1h_input_tokens`) is **not** captured, so exact 1-hour-write pricing is impossible downstream until the adapter records it.

---

## 7. Validation — three-way reconciliation

A read-only audit reconciles the chain independently: it **re-parses the raw transcript from scratch** (not via our adapter) for ground truth, reads our NDJSON store, and applies an exact mirror of `effectiveTokens` + the §3 pricing table.

**Method (per session):**
1. **Truth** — union all assistant lines from the main transcript + every `subagents/*.jsonl`, dedup by `requestId` (last-wins); sum each token class; price each request at its model's rate (using the per-TTL cache split when present).
2. **Ours** — read every `usage-*-<sessionId>.ndjson`, dedup by `usageId`.
3. **Reconcile** — requestId set diff (missing ⇒ under-capture; extra ⇒ over-capture), per-field mismatch on shared ids, raw-vs-effective-vs-`$`, per-model `effective × base_rate` identity check, main-vs-subagent split.

**Result — session `c957bf1d` (1,149 requests, 27 subagents), audited 2026-06-20:**

| Check | Outcome |
|---|---|
| Capture parity | **1,149 = 1,149**, 0 missing, 0 extra, 0 value-mismatched |
| Per-type integers | input / output / cache-read / cache-create all **exact** (e.g. cache-read 76,815,411 = 76,815,411) |
| Raw total | **79.8M** tokens |
| Effective (Spend) | **13.87M** = **0.17× raw** (cache-read is 96% of raw, weighted 0.1×) |
| Ground-truth cost | **≈ $62.32** (standard rates; 1M-premium unmodeled) |
| Per-model | Opus 8.92M eff / $48.70 · Sonnet 4.34M eff / $13.01 · Haiku 0.61M eff / $0.61 |
| 1h-cache effect | Opus identity `eff×$5` ⇒ $44.60 vs actual $48.70 → **Δ $4.10** = the 1h-write under-weight (§5) |
| Mixed-model shortcut | `13.87M × $5/MTok = $69.35` vs true `$62.32` → naive single-rate over-reads **+11%** |

**What it proves:** (a) `lib/telemetry` captures the raw logs faithfully — no drops, dupes, or field errors; (b) the metric is **not inflated** vs raw — it is far smaller on cache-heavy sessions; (c) it is **cost-faithful per model**, off only by the small, *downward* 1h-cache bias; (d) the only thing blocking "easy math to cost" is the model-agnostic aggregation, addressed per-model on the details page.

---

## 8. Caveats & known edges

- **Mixed-model aggregation** — the aggregate effective number ≠ `cost / one_rate`. Always split by model for dollars. (By design; details-page concern.)
- **1-hour cache writes** under-weighted `1.25×` vs `2.0×` because the TTL split is not stored (§6). Downward bias.
- **1M-context premium** above 200k input is unmodeled (§3.3). Downward bias on big-context Opus.
- **Tokenizer shift** (Opus 4.7+) changes counts, not rates — don't compare raw volumes across the boundary.
- **Cumulative cache-read** makes any honest session-total token figure look huge (§2.2) — expected, not a defect.
- **All client estimates are estimates** — ours and Claude Code's `total_cost_usd` alike; the Console Usage page is the billing source of truth.

---

## 9. Appendix — reproducible constants & method

Pricing table and the effective-weights, ready to lift into a per-model cost module:

```js
// USD per 1,000,000 tokens. Re-verify against the live pricing page (§3.1).
const PER_M = {
  opus:   { input: 5,  output: 25, write5m: 6.25, write1h: 10, read: 0.5 },
  sonnet: { input: 3,  output: 15, write5m: 3.75, write1h: 6,  read: 0.3 },
  haiku:  { input: 1,  output: 5,  write5m: 1.25, write1h: 2,  read: 0.1 },
  fable:  { input: 10, output: 50, write5m: 12.5, write1h: 20, read: 1   },
};
// family = first of opus|sonnet|haiku|fable found in the model id (lowercased).

const dollarsForRequest = (u, fam) => (
    u.input  * PER_M[fam].input   + u.output  * PER_M[fam].output
  + u.read   * PER_M[fam].read    + u.write5m * PER_M[fam].write5m
  + u.write1h* PER_M[fam].write1h
) / 1e6;

// Model-agnostic spend proxy (mirrors ui/lib/observability/effective-tokens.ts):
const effective = (u) => u.input*1 + u.output*5 + u.read*0.1 + (u.write5m + u.write1h)*1.25;

// Single-model identity:  effective(u) * (PER_M[fam].input / 1e6)  ===  dollarsForRequest(u, fam)
//   ...exact when write1h === 0; otherwise low by (write1h * 0.75 * input_rate).
```

**Reconciliation algorithm (to re-derive the audit):** build `truth` = `{requestId → {model, usage}}` by unioning main-transcript + `subagents/*.jsonl` assistant lines (dedup last-wins by `requestId`); build `ours` from `usage-*-<sessionId>.ndjson` (dedup by `usageId`); compare the keyed sets and per-field values; then compute raw / `effective` / `$` on each side. Locations: transcripts under `~/.claude/projects/<slug>/<session>.jsonl`; store under `~/.radorc/telemetry/usage/`.

---

## 10. Sources

- Pricing (model rates, cache multipliers, batch, `inference_geo`, worked examples): `platform.claude.com/docs` → *Pricing*.
- Prompt-cache accounting (the disjoint `usage` fields, the `total_input` formula, per-TTL `cache_creation`): `platform.claude.com/docs` → *Prompt caching*.
- Claude Code cost (`total_cost_usd` is a local estimate; Console is authoritative): `code.claude.com/docs` → *Costs*.
- Statusline JSON schema (`cost` cumulative; `context_window` occupancy-only since v2.1.132; `transcript_path`): `code.claude.com/docs` → *Statusline*.
- This repo: `lib/telemetry/src/**`, `ui/lib/observability/**`, and the §7 first-party audit (2026-06-20).
