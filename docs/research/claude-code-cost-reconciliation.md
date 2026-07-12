# Reconciling the Observability Dashboard "Cost (USD)" with Claude Code's `/cost`

**Status:** Complete (root cause identified and proven)
**Date:** 2026-07-12
**Branch:** `telemetry-1h-cache-pricing`
**Claude Code version under test:** `2.1.207` (native Windows binary)
**Author:** investigation conducted in session `ff213b26`

---

## TL;DR

The rad-orc observability dashboard computes a session's **Cost (USD)** by mining Claude
Code's session transcript (`~/.claude/projects/**/<session>.jsonl`) and pricing the usage
records. The terminal's `/cost` command is treated as the source of truth. On some sessions
the dashboard reads **below** `/cost`, and the gap **grows as the session gets longer**.

After eliminating every pricing- and capture-related explanation, we instrumented Claude
Code with OpenTelemetry and proved the cause:

> **Claude Code's `/cost` is an in-process accumulator of _every_ API call the CLI makes —
> including background calls that are never written to the session transcript. The dashboard
> mines the transcript, so it structurally cannot see those calls and therefore undercounts.**

The un-transcribed calls we identified, by their OTEL `query_source` attribute:

| `query_source` | model | in transcript? | when | cost signature |
|---|---|---|---|---|
| `repl_main_thread` | main model (Sonnet 5) | ✅ yes | every user turn | the real conversation |
| **`prompt_suggestion`** | Sonnet 5 | ❌ **no** | ~every 2–3 turns | **re-reads the whole context**, ~504 in / ~17 out, **$0.02–0.025 and rising with context** |
| **`generate_session_title`** | Haiku 4.5 | ❌ **no** | once per session | ~$0.0006 (negligible) |

**`prompt_suggestion`** (Claude Code's "suggested follow-up prompt" feature) is the dominant
driver. It re-reads the entire conversation each time it fires, so its per-call cost grows
with the session, and the calls accumulate — exactly matching the observed "starts equal,
drifts as the session grows" behavior.

Our pricing math and our capture pipeline were both proven **correct to the cent**. The
dashboard shows the true *conversation* cost; `/cost` shows *conversation + Claude Code's
own background overhead*.

**Recommended fix:** ingest Claude Code's OTEL `claude_code.api_request` stream (which
reproduces `/cost` exactly and carries `query_source`), so the UI can show conversation cost,
Claude Code overhead, and a `/cost`-matching total.

---

## 1. Problem statement

- **Goal:** the dashboard's Cost (USD) should match the terminal `/cost`. If the two disagree,
  users won't trust the dashboard.
- **Symptom:** on some sessions the dashboard reads under `/cost`, starting equal on the first
  turn or two and drifting further behind as the session grows.
- **Constraint:** the dashboard's cost is computed from the Claude Code transcript via the
  `@rad-orchestration/telemetry` library (hooks → capture → NDJSON store → API → UI).

Two earlier, unrelated bugs in this area had already been found and fixed on this branch and
are **not** the subject of this report (see §3).

## 2. Background: the two cost computations

### 2.1 rad-orc dashboard (transcript-mined)

```
Claude Code writes transcript (~/.claude/projects/<proj>/<session>.jsonl)
  └─ PostToolUse/Stop/SessionEnd hook → telemetry-capture.mjs → radorch telemetry capture
       └─ ClaudeCodeAdapter → NDJSON store (~/.radorc/telemetry/usage/usage-<date>-<session>.ndjson)
            └─ read/observability-row → API (/api/observability/usage) → UI dashboard
                 └─ Cost (USD) = Σ dollarsFor(row)   [lib/telemetry/src/read/pricing.ts]
```

Key wiring fact (verified): the dashboard's Cost (USD) imports `dollarsFor` from
`@rad-orchestration/telemetry/read/pricing` (`ui/lib/observability/spend-display.ts`). There is
**no separate UI pricing table**; editing `lib/telemetry/src/read/pricing.ts` drives the UI
(after a full `next build`, because pricing is inlined into the `.next` chunks).

### 2.2 Claude Code `/cost` (in-process accumulator)

Claude Code does **not** read the transcript to compute `/cost`. It accumulates the `cost_usd`
of **every API response the CLI process receives**, in memory, using a bundled pricing table.
This includes conversation turns *and* background/auxiliary calls. This distinction is the
entire root cause.

## 3. Prior fixes (context only — already committed)

| commit | fix |
|---|---|
| `4035b7b5` | Price 1-hour prompt-cache writes at the 1h rate (was 5m). Splits `cache_creation` by TTL using `cache_creation.ephemeral_1h_input_tokens`. |
| `3dcbb42f` | Price Sonnet 5 at **list** ($3/$15), not the $2/$10 intro discount, because `/cost` bills at list. |

Both were validated and are orthogonal to the drift described here.

## 4. Methodology

We built a **lockstep reconciliation** workflow: run a controlled Claude Code session, then
compare, per turn and cumulatively, three numbers that should agree —

1. **Transcript truth** — the raw `usage` records in the `.jsonl`, priced with the deployed
   `dollarsFor` (which we proved equals Claude Code's own math).
2. **Our store** — the NDJSON partition the dashboard reads.
3. **Claude Code `/cost`** — reported by the user from the TUI.

When (1)==(2) but both < (3), the gap is *outside* our pipeline. To see what `/cost` counts
that the transcript omits, we then instrumented Claude Code with **OpenTelemetry** and captured
every billed API call via a local OTLP collector.

Tools built (sources in Appendix C):

- `lockstep.mjs` — reconciles transcript vs store per turn, prices with the deployed table,
  flags missing/mismatched rows, and detects inherited caches.
- `otel-collector.mjs` — a dependency-free local OTLP/HTTP endpoint that logs every export
  payload Claude Code sends.
- `extract-otel.mjs` / `extract-otel-attrs.mjs` — parse the captured OTLP logs into per-call
  rows (model, tokens, cost, `query_source`, …).
- `audit-session.mjs` (pre-existing, `lib/telemetry/scripts/`) — three-way reconciliation oracle
  (raw transcript vs store vs effective/$).
- Binary string-extraction scripts — pull Claude Code's cost function, pricing tiers, and
  request-source taxonomy out of the compiled binary.

## 5. Findings (chain of elimination)

### 5.1 Pricing is byte-for-byte identical to Claude Code's

We extracted Claude Code's own cost function and pricing table from the compiled binary
(`~/.local/share/claude/versions/2.1.207`) by scanning for readable strings:

```js
// Claude Code's per-response cost (de-minified):
function fYm(e, t) {                                   // cache-write TTL split
  let r = t.cache_creation_input_tokens ?? 0,
      n = e.promptCacheWrite1hTokens,
      o = Math.min(t.cache_creation?.ephemeral_1h_input_tokens ?? 0, r);
  if (n === void 0 || o <= 0) return r / 1e6 * e.promptCacheWriteTokens;
  return o / 1e6 * n + (r - o) / 1e6 * e.promptCacheWriteTokens;
}
function shi(e, t) {                                   // total for one response
  return t.input_tokens  / 1e6 * e.inputTokens
       + t.output_tokens / 1e6 * e.outputTokens
       + (t.cache_read_input_tokens ?? 0) / 1e6 * e.promptCacheReadTokens
       + fYm(e, t);
}
```

This is structurally **identical** to our `dollarsFor`, including the 1h/5m cache-write split.
The pricing tiers (also extracted):

```
pricing_tiers = {
  tier_3_15:  { input:3,  output:15, cache_write_5m:3.75,  cache_write_1h:6,  cache_read:0.3 },
  tier_5_25:  { input:5,  output:25, cache_write_5m:6.25,  cache_write_1h:10, cache_read:0.5 },
  tier_15_75: { input:15, output:75, cache_write_5m:18.75, cache_write_1h:30, cache_read:1.5 },
  tier_10_50: { input:10, output:50, cache_write_5m:12.5,  cache_write_1h:20, cache_read:1   },
  haiku_35:   { input:0.8,output:4,  cache_write_5m:1,     cache_write_1h:1.6,cache_read:0.08},
  haiku_45:   { input:1,  output:5,  cache_write_5m:1.25,  cache_write_1h:2,  cache_read:0.1 },
}
```

`claude-sonnet-5` maps to **`tier_3_15`** — identical to our Sonnet 5 rates. **Conclusion: the
pricing is not the problem.**

Two hypotheses died here:

- **>200K "long-context premium" tier.** Sonnet 5's catalog entry is `context:{window:1e6,
  native_1m:true}`, but the `pricing_tiers` table has **no** premium tier and `shi()` applies
  **flat** rates regardless of context size. Claude Code's `/cost` does not implement a
  long-context premium at all.
- **Inherited-"prime" cost.** A resumed/forked session's first request reads an inherited
  cached prefix, but `/cost` does not add the upstream creation cost of that prefix (confirmed
  live: a session that inherited a 32,426-token cache still matched on turn 1).

### 5.2 Our capture is faithful

`audit-session.mjs` and `lockstep.mjs` both show **store == transcript, token-for-token**, on
every session tested, and `dollarsFor(store) == dollarsFor(transcript)` to the cent. The
dashboard faithfully reflects the transcript. (One incidental transcript artifact — an assistant
turn split across two lines, one carrying `thinking`, one `text`, both stamped with the same
`usage` — is correctly de-duplicated by `requestId` in both our pipeline and Claude Code's.)

### 5.3 The gap is transcript-vs-`/cost`, not UI-vs-transcript

On session `76133b29` (Sonnet, tiny Q&A turns), the transcript summed to `$0.1307` on turn 2
while `/cost` read `$0.1482`. Our store matched the transcript exactly. So the missing
`$0.0175` is billed activity **not present in the transcript in any form** (verified: exactly
2 unique `requestId`s, no retries, no duplicate usage records, no thinking blocks). Ruled out
here: thinking tokens (the thinking-heavy turn 1 matched; the diverging turns had no thinking
blocks) and user-configured LLM hooks (all hooks are plain `command` scripts).

### 5.4 OTEL instrumentation reveals the hidden calls

We enabled Claude Code telemetry against a local OTLP collector:

```
CLAUDE_CODE_ENABLE_TELEMETRY=1
OTEL_METRICS_EXPORTER=otlp
OTEL_LOGS_EXPORTER=otlp
OTEL_EXPORTER_OTLP_PROTOCOL=http/json
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318
OTEL_METRIC_EXPORT_INTERVAL=3000
OTEL_BLRP_SCHEDULE_DELAY=1000
```

Claude Code emits, per API call, a `claude_code.api_request` **log event** (and a
`claude_code.cost.usage` **metric**) carrying: `model`, `input_tokens`, `output_tokens`,
`cache_read_tokens`, `cache_creation_tokens`, `cost_usd`, `cost_usd_micros`, `duration_ms`,
`request_id`, `session.id`, `prompt.id`, `effort`, `speed`, and crucially **`query_source`**.

**The sum of OTEL `cost_usd` equals `/cost` exactly** — see §6. This both identifies the hidden
calls and proves OTEL is a faithful cost source.

### 5.5 Root cause: `prompt_suggestion` (+ `generate_session_title`)

Matching every OTEL call against the transcript on the definitive 6-turn session (§6.2), the
calls **not** in the transcript were:

- **`query_source: "prompt_suggestion"`** — Sonnet 5, `effort: medium`. A fixed ~504-token
  instruction + the **entire conversation** (read from cache) → ~17 output tokens. This is
  Claude Code's "suggested next prompt" feature. It fires roughly every 2–3 turns, and because
  it re-reads the whole context, its cost **grows with the session** (`$0.0213` at 49,984 cached
  tokens → `$0.0247` at 54,287). Toggle: env var `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION`.
- **`query_source: "generate_session_title"`** — Haiku 4.5, one-time, ~`$0.0006`. Negligible.

Real turns carry `query_source: "repl_main_thread"`.

## 6. Reconciliation data

### 6.1 Session summary (all runs)

| session | turns | tooling | transcript / UI | `/cost` | gap | hidden calls |
|---|---|---|---|---|---|---|
| `27156374` (fork) | 4 | none | $0.1592 | ~$0.19 | ~$0.03 | ~1–2 `prompt_suggestion` (inferred) |
| `76133b29` | 3 | none | $0.1467 | $0.1812 | $0.0345 | ~2 `prompt_suggestion` (inferred) |
| `80da28ea` | 1 | none | $0.1133 | $0.1139 | ~$0 | title only |
| `516038a8` (OTEL) | 2 | none | $0.1357 | $0.1363 | $0.0006 | title only |
| **`45342f23` (OTEL)** | 6 | none | $0.2717 | $0.3183 | $0.0466 | title + **2×`prompt_suggestion`** |

Note the pattern: 1 turn → ~0 gap; 2 turns → title only; 6 turns → title + 2 suggestions. The
gap tracks **turns × context size**, not pricing.

### 6.2 The definitive 6-turn OTEL session (`45342f23`)

Every billed call, from OTEL, matched to the transcript:

| seq | `query_source` | model | cost | in | out | cacheRead | in transcript |
|---|---|---|---|---|---|---|---|
| — | `generate_session_title` | haiku-4-5 | $0.00057 | 519 | 11 | 0 | ❌ |
| T1 | `repl_main_thread` | sonnet-5 | $0.11606 | 2 | 489 | 32426 | ✅ |
| T2 | `repl_main_thread` | sonnet-5 | $0.02583 | 2 | 542 | 48924 | ✅ |
| T3 | `repl_main_thread` | sonnet-5 | $0.02952 | 2 | 756 | 49427 | ✅ |
| — | **`prompt_suggestion`** | sonnet-5 | **$0.02131** | 504 | 18 | 49984 | ❌ |
| T4 | `repl_main_thread` | sonnet-5 | $0.04165 | 2 | 585 | 50740 | ✅ |
| T5 | `repl_main_thread` | sonnet-5 | $0.03630 | 2 | 1104 | 53682 | ✅ |
| — | **`prompt_suggestion`** | sonnet-5 | **$0.02468** | 504 | 17 | 54287 | ❌ |
| T6 | `repl_main_thread` | sonnet-5 | $0.02234 | 2 | 374 | 55391 | ✅ |

Reconciliation:

```
Transcript / dashboard (T1..T6)         = $0.2717   (UI shows $0.27)
OTEL Σ cost_usd (all 9 calls)           = $0.31826
/cost after turn 6 (user-reported)      = $0.3183   ← matches OTEL to the cent
Gap = 0.31826 - 0.2717 = $0.0466
    = title $0.00057 + suggestion $0.02131 + suggestion $0.02468

Checkpoint /cost after turn 3           = $0.1720
  = title + T1 + T2 + T3 = 0.00057 + 0.11606 + 0.02583 + 0.02952 = $0.17198  ✓
  (the first prompt_suggestion had not yet fired at the turn-3 checkpoint)
```

## 7. Root cause (statement)

> Claude Code's `/cost` = Σ `cost_usd` over **all** API calls the CLI process makes, including
> `prompt_suggestion` (Sonnet, per few-turns, re-reads full context) and
> `generate_session_title` (Haiku, once). The session transcript records **only**
> `repl_main_thread` turns. Any cost computed by mining the transcript therefore omits the
> background calls and reads under `/cost`, by an amount that grows with turns and context size.
>
> This is a **data-source ceiling**, not a defect in rad-orc's pricing or capture — both were
> proven correct to the cent. Neither `ccusage` nor any other transcript-based tool can match
> `/cost` for the same reason.

## 8. The auto-mode question

The environment runs `permissions.defaultMode: auto`. Binary strings show auto-mode has its own
model machinery:

- `CLAUDE_CODE_AUTO_MODE_MODEL` — auto-mode uses a configurable model (i.e., it makes calls).
- `isAutoModeClassifyAllShellEnabled` — auto-mode runs an **LLM classifier on shell commands**
  to decide auto-approval. Also present: `getAutoModeConfig`, `handleAutoModeTransition`,
  `CLAUDE_CODE_AUTO_MODE_EXTERNAL_PERMISSIONS`.

**Assessment:** in a **tool/shell-using** session, auto-mode very plausibly makes additional
billed, un-transcribed classification calls, adding to the same class of drift. **However, we
did not observe any auto-mode call in these tests, because every test session was pure Q&A with
no tool use** — the shell classifier had nothing to classify. This remains an open item: a
tool-heavy OTEL run is needed to measure it. It does **not** affect the confirmed
`prompt_suggestion` finding, which fires regardless of tool use.

Complete request-origin taxonomy found in the binary (some observed, some inferred):
`repl_main_thread`, `prompt_suggestion`, `generate_session_title`, and origin labels
`sdk` / `main` / `agent` / `hook_agent` / `subagent` / `auxiliary`, plus the auto-mode classifier.

## 9. Implications and fix options

The overhead is **material** on real sessions: at 6 trivial turns it was 15% of `/cost`, and
because each `prompt_suggestion` re-reads the full context, both the per-call cost and the
cumulative gap grow with a long working session.

| option | matches `/cost`? | effort | notes |
|---|---|---|---|
| **1. Ingest OTEL `claude_code.api_request`** | **exactly** | high | rad-orc runs an OTLP collector; the harness installer (already sets hooks) also sets the OTEL env. Every event carries `query_source`, so the UI can show **conversation cost** (`repl_main_thread`) + **Claude Code overhead** (`prompt_suggestion`/`title`/auto-mode) + a **`/cost`-matching total**. Richer than `/cost` itself. |
| 2. Keep transcript-mining + document | no (reads under) | low | Honest "true conversation cost", but always trails `/cost` on long sessions. |
| 3. Hybrid | total only | medium | Transcript for per-turn conversation cost, OTEL for the matching total. |

**Recommendation: Option 1 (OTEL ingestion with `query_source` attribution).** It reproduces
`/cost` to the cent, captures the calls the transcript cannot, and lets the dashboard *explain*
the number rather than merely match it. Keep the transcript pipeline as a cross-check/fallback.

**User-side quick win (personal sessions only):** set `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=0`
to stop the suggestion calls; the TUI and dashboard then converge (leaving only the ~$0.0006
Haiku title). This does not fix observability for sessions run by others.

## 10. How to reproduce

1. **Start the local OTLP collector** (Appendix C.2): `node otel-collector.mjs` (listens on
   `127.0.0.1:4318`, appends every export to `otel-capture.log`).
2. **Run an instrumented session** with the env in §5.4, e.g.
   `claude --model claude-sonnet-5`, and do 6+ turns of ordinary Q&A. Run `/cost` at a couple
   of checkpoints. `/quit` to flush the exporters.
3. **Reconcile:** `node lockstep.mjs <sessionId|auto>` (transcript vs store) and
   `node extract-otel.mjs` (per-call OTEL breakdown). Confirm Σ OTEL `cost_usd` == `/cost` and
   that the extra calls carry `query_source` in {`prompt_suggestion`, `generate_session_title`}.
4. **Identify a call:** `extract-otel-attrs.mjs` dumps full attributes for chosen `request_id`s.

To also characterize auto-mode: repeat step 2 in a session that runs shell/tool commands and
look for OTEL calls whose `query_source`/model indicate the auto-mode classifier.

---

## Appendix A — Environment & paths

- Claude Code binary: `C:\Users\Metal\.local\share\claude\versions\2.1.207` (PE32+, ~247 MB, JS embedded)
- Transcripts: `C:\Users\Metal\.claude\projects\c--dev-orchestration-v3\<session>.jsonl`
- rad-orc store: `C:\Users\Metal\.radorc\telemetry\usage\usage-<date>-<session>.ndjson`
- Deployed pricing used for scoring: `C:\Users\Metal\.radorc\ui\lib\telemetry\dist\read\pricing.js`
- Pricing source of truth: `lib/telemetry/src/read/pricing.ts` (drives the UI via `spend-display.ts`)
- Hooks (`~/.claude/settings.json`): `SessionStart` → `session-preamble.mjs`;
  `PostToolUse`/`Stop`/`SessionEnd` → `telemetry-capture.mjs`. No LLM hooks.

## Appendix B — OTEL `claude_code.api_request` attribute schema (observed)

```
log record body: "claude_code.api_request"
attributes:
  model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
  cost_usd, cost_usd_micros, duration_ms, request_id, prompt.id, event.sequence,
  event.timestamp, query_source, effort, speed, session.id, organization.id,
  user.id, user.email, user.account_uuid, user.account_id, terminal.type
resource attributes:
  service.name="claude-code", service.version, os.type, os.version, host.arch
metric: claude_code.cost.usage  (counter, attribute: model)  — Σ == /cost
```

## Appendix C — Tool sources

> These were developed in the session scratchpad during the investigation. They are embedded
> here so the research is reproducible after the scratchpad is cleared. Paths inside them are
> absolute to this machine; adjust as needed.

### C.1 `lockstep.mjs` (transcript vs store reconciler)

```js
// Given a sessionId (or "auto" = newest non-current transcript), compare Claude's transcript
// (what /cost sums) against the ~/.radorc store (what the UI shows), per turn and cumulative,
// pricing both with the deployed dollarsFor. Flags missing/mismatched rows and inherited caches.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const PROJ = 'C:/Users/Metal/.claude/projects/c--dev-orchestration-v3';
const STORE = 'C:/Users/Metal/.radorc/telemetry/usage';
const { dollarsFor } = await import(pathToFileURL('C:/Users/Metal/.radorc/ui/lib/telemetry/dist/read/pricing.js').href);
let sid = process.argv[2] || 'auto';
if (sid === 'auto') {
  const cands = readdirSync(PROJ).filter(f => f.endsWith('.jsonl'))
    .map(f => ({ f, m: statSync(`${PROJ}/${f}`).mtimeMs })).sort((a, b) => b.m - a.m);
  sid = cands[0]?.f.replace('.jsonl', '');
}
const truth = []; const seen = new Set();
for (const line of readFileSync(`${PROJ}/${sid}.jsonl`, 'utf8').split('\n').filter(Boolean)) {
  let o; try { o = JSON.parse(line); } catch { continue; }
  const u = o?.message?.usage;
  if (o.type === 'assistant' && u && o.requestId && !seen.has(o.requestId)) {
    seen.add(o.requestId);
    truth.push({ req: o.requestId, timestamp: o.timestamp, model: o.message.model,
      inputTokens: u.input_tokens ?? 0, outputTokens: u.output_tokens ?? 0,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
      cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
      cacheCreation1hTokens: u.cache_creation?.ephemeral_1h_input_tokens ?? u.cache_creation_input_tokens ?? 0 });
  }
}
const store = [];
for (const f of readdirSync(STORE).filter(f => f.includes(sid) && f.endsWith('.ndjson')))
  for (const line of readFileSync(`${STORE}/${f}`, 'utf8').split('\n').filter(Boolean))
    try { store.push(JSON.parse(line)); } catch {}
const byReq = new Map(store.map(r => [r.usageId, r]));
let cT = 0, cS = 0;
truth.forEach((r, i) => {
  const tD = dollarsFor(r) ?? 0; cT += tD;
  const s = byReq.get(r.req);
  const sD = s ? (dollarsFor({ ...s, cacheCreation1hTokens: s.cacheCreation1hTokens }) ?? 0) : 0;
  cS += sD;
  console.log(`${i + 1}  ${r.req.slice(0,13)} in=${r.inputTokens} out=${r.outputTokens} read=${r.cacheReadTokens} wr=${r.cacheCreationTokens} tD=$${tD.toFixed(4)} cumT=$${cT.toFixed(4)} cumS=$${cS.toFixed(4)} ${s ? 'ok' : 'MISSING'}`);
});
console.log(`CLAUDE(transcript)=$${cT.toFixed(4)}  OURS(store)=$${cS.toFixed(4)}`);
```

### C.2 `otel-collector.mjs` (local OTLP/HTTP capture)

```js
import http from 'node:http';
import { appendFileSync, writeFileSync } from 'node:fs';
const OUT = './otel-capture.log';
writeFileSync(OUT, `otlp collector started\n`);
http.createServer((req, res) => {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const buf = Buffer.concat(chunks);
    let rec; try { rec = JSON.stringify(JSON.parse(buf.toString('utf8'))); }
    catch { rec = 'NONJSON:' + buf.toString('latin1').replace(/[^\x09\x20-\x7e]/g, '.'); }
    appendFileSync(OUT, `\n##### ${req.method} ${req.url} bytes=${buf.length} #####\n${rec}\n`);
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}');
  });
}).listen(4318, '127.0.0.1', () => console.log('otlp collector on http://127.0.0.1:4318'));
```

### C.3 `extract-otel.mjs` (per-call breakdown)

Parses `otel-capture.log`, walks `resourceLogs[].scopeLogs[].logRecords[]`, and prints one row
per `claude_code.api_request` event: `model`, `cost_usd`, `input/output/cache tokens`,
`request_id`, `query_source`; sums `cost_usd` and cross-checks against the
`claude_code.cost.usage` metric total. (See `extract-otel-attrs.mjs` for a full-attribute dump
by `request_id`.)

## Appendix D — Hypotheses tested and rejected

| hypothesis | verdict | evidence |
|---|---|---|
| Dashboard prices Sonnet at intro, `/cost` at list | fixed earlier (`3dcbb42f`) | — |
| 1h cache-writes priced at 5m rate | fixed earlier (`4035b7b5`) | — |
| >200K long-context premium tier | **rejected** | binary: no premium tier; `shi()` is flat |
| Inherited "prime" creation cost added by `/cost` | **rejected** | inherited 32,426-token cache still matched on turn 1 |
| Thinking tokens under-counted in transcript | **rejected** | thinking-heavy turn 1 matched; diverging turns had no thinking |
| User LLM hooks firing per turn | **rejected** | all hooks are `command` scripts |
| Live-tail / SSE / chokidar lag | **rejected** | settled transcript; store==transcript==UI |
| Our pricing or capture is wrong | **rejected** | identical to Claude Code's; reconciles to the cent |
| **Un-transcribed background API calls (`prompt_suggestion`, title)** | **CONFIRMED** | OTEL Σ == `/cost`; extra calls carry those `query_source`s |
| Auto-mode shell-classifier calls | **open / plausible** | binary shows the machinery; not observed in tool-free tests |
