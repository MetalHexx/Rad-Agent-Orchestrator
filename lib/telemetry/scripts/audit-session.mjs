#!/usr/bin/env node
// audit-session.mjs — three-way token reconciliation for ONE session:
//
//   (A) raw Claude Code transcript(s)   → independent ground-truth tokens & $
//   (B) our NDJSON telemetry store      → what lib/telemetry actually captured
//   (C) effectiveTokens()               → the dashboard's "Spend" unit
//
// Read-only. Node built-ins only. The (B)->(C) math MIRRORS
// ui/lib/observability/effective-tokens.ts and the lib/telemetry read dedup so the
// numbers equal what the dashboard shows. (A) is parsed from scratch so it is a
// genuinely independent oracle, not a re-run of our own adapter.
//
// Usage:
//   node audit-session.mjs --list
//   node audit-session.mjs --session <sessionId-or-prefix>
//   [--projects <dir>] [--root <telemetryRoot>]

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ---------------- args / locations ----------------
function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--session') a.session = argv[++i];
    else if (t === '--projects') a.projects = argv[++i];
    else if (t === '--root') a.root = argv[++i];
    else if (t === '--list') a.list = true;
  }
  return a;
}
const args = parseArgs(process.argv.slice(2));
const ROOT = args.root ?? process.env.RADORC_TELEMETRY_ROOT ?? path.join(os.homedir(), '.radorc', 'telemetry');
const PROJECTS = args.projects ?? path.join(os.homedir(), '.claude', 'projects');
const USAGE_DIR = path.join(ROOT, 'usage');

// ---------------- pricing (USD per 1,000,000 tokens) — MIRROR of lib/telemetry/src/read/pricing.ts ----------------
// Ratios vs base input are identical across families (output 5x, write-5m 1.25x,
// write-1h 2x, read 0.1x); only the base rate differs. Sonnet 5 is priced at LIST rate
// ($3/$15) — the $2/$10 intro discount (through 2026-08-31) is intentionally NOT applied,
// mirroring read/pricing.ts so this oracle matches Claude Code's /cost. The date-window
// machinery is retained for future use; the last window whose `from` has arrived wins.
// Source: platform.claude.com/docs pricing.
const PRICING = {
  haiku:  [{ from: '', p: { input: 1,  output: 5,  read: 0.10, write5m: 1.25,  write1h: 2  } }],
  sonnet: [{ from: '', p: { input: 3,  output: 15, read: 0.30, write5m: 3.75,  write1h: 6  } }],
  opus:   [{ from: '', p: { input: 5,  output: 25, read: 0.50, write5m: 6.25,  write1h: 10 } }],
  fable:  [{ from: '', p: { input: 10, output: 50, read: 1.00, write5m: 12.5,  write1h: 20 } }],
};
function familyOf(model) {
  const m = String(model || '').toLowerCase();
  if (m.includes('opus')) return 'opus';
  if (m.includes('sonnet')) return 'sonnet';
  if (m.includes('haiku')) return 'haiku';
  if (m.includes('fable')) return 'fable';
  if (m.includes('mythos')) return 'fable'; // Mythos bills at Fable rates — mirrors read/pricing.ts
  return 'opus'; // safe default; surfaced as "unknown" in the per-model table
}
function pricesFor(family, at) {
  const date = String(at || '').slice(0, 10);
  let sel = null;
  for (const w of PRICING[family]) if (w.from <= date) sel = w.p; // '' always applies
  return sel;
}
function dollarsFor(u, model, at) {
  const p = pricesFor(familyOf(model), at);
  return (u.input * p.input + u.output * p.output + u.read * p.read
        + u.write5m * p.write5m + u.write1h * p.write1h) / 1e6;
}

// ---------------- effectiveTokens — MIRROR of ui/lib/observability/effective-tokens.ts ----------------
// input*1 + output*5 + cacheRead*0.1 + write5m*1.25 + write1h*2  (cache-write weighted by TTL)
function effectiveOf(u) {
  return u.input * 1 + u.output * 5 + u.read * 0.1 + u.write5m * 1.25 + u.write1h * 2;
}
function rawTotalOf(u) { return u.input + u.output + u.read + u.write5m + u.write1h; }

const emptyU = () => ({ input: 0, output: 0, read: 0, write5m: 0, write1h: 0 });
function addU(acc, u) {
  acc.input += u.input; acc.output += u.output; acc.read += u.read;
  acc.write5m += u.write5m; acc.write1h += u.write1h; return acc;
}

// ---------------- (A) raw transcript ----------------
function usageFromRawLine(line) {
  const u = line.message?.usage; if (!u) return null;
  const out = emptyU();
  out.input = u.input_tokens || 0;
  out.output = u.output_tokens || 0;
  out.read = u.cache_read_input_tokens || 0;
  if (u.cache_creation && typeof u.cache_creation === 'object') {
    out.write5m = u.cache_creation.ephemeral_5m_input_tokens || 0;
    out.write1h = u.cache_creation.ephemeral_1h_input_tokens || 0;
  } else {
    out.write5m = u.cache_creation_input_tokens || 0; // flat field; our store flattens the same way
  }
  return out;
}
function readRawAssistant(file) {
  let text; try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const rows = [];
  for (const ln of text.split('\n')) {
    const t = ln.trim(); if (!t) continue;
    let o; try { o = JSON.parse(t); } catch { continue; }
    if (o.type !== 'assistant' || !o.requestId) continue;
    const u = usageFromRawLine(o); if (!u) continue;
    rows.push({ requestId: o.requestId, model: o.message?.model || 'unknown', timestamp: o.timestamp || '', isSidechain: !!o.isSidechain, u });
  }
  return rows;
}
function findMain(prefix) {
  let dirs = []; try { dirs = fs.readdirSync(PROJECTS); } catch { return null; }
  for (const d of dirs) {
    const pdir = path.join(PROJECTS, d);
    let files = []; try { files = fs.readdirSync(pdir); } catch { continue; }
    for (const f of files) {
      if (f.endsWith('.jsonl') && f.slice(0, -6).startsWith(prefix)) {
        return { file: path.join(pdir, f), id: f.slice(0, -6), pdir };
      }
    }
  }
  return null;
}
function subagentFiles(main) {
  const dir = path.join(main.pdir, main.id, 'subagents');
  try { return fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(dir, f)); }
  catch { return []; }
}

// ---------------- (B) our store ----------------
function readOurStore(sessionId) {
  let files = []; try { files = fs.readdirSync(USAGE_DIR); } catch { return []; }
  const want = files.filter((f) => /\.ndjson$/.test(f) && f.includes(sessionId));
  const recs = [];
  for (const f of want) {
    let text; try { text = fs.readFileSync(path.join(USAGE_DIR, f), 'utf8'); } catch { continue; }
    for (const ln of text.split('\n')) {
      const t = ln.trim(); if (!t) continue;
      let o; try { o = JSON.parse(t); } catch { continue; }
      if (!o.usageId) continue;
      recs.push(o);
    }
  }
  return { recs, partitions: want };
}
function ourUsage(rec) {
  const u = emptyU();
  u.input = rec.inputTokens || 0; u.output = rec.outputTokens || 0;
  u.read = rec.cacheReadTokens || 0;
  // Split cache-creation by TTL, mirroring read/pricing.ts + read/effective-tokens.ts:
  // the 1h subset (clamped ≤ total) prices/weights at the 1h rate, remainder at 5m.
  const create = rec.cacheCreationTokens || 0;
  const oneHour = Math.min(create, rec.cacheCreation1hTokens || 0);
  u.write1h = oneHour; u.write5m = create - oneHour;
  return u;
}

// ---------------- formatting ----------------
const n = (x) => Math.round(x).toLocaleString('en-US');
const usd = (x) => '$' + x.toFixed(4);
const pct = (x) => (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%';
const line = (c = '-') => console.log(c.repeat(72));

// ---------------- --list ----------------
function listSessions() {
  const tx = new Map(); // id -> bytes
  let dirs = []; try { dirs = fs.readdirSync(PROJECTS); } catch {}
  for (const d of dirs) {
    const pdir = path.join(PROJECTS, d);
    let files = []; try { files = fs.readdirSync(pdir); } catch { continue; }
    for (const f of files) if (f.endsWith('.jsonl')) {
      try { tx.set(f.slice(0, -6), fs.statSync(path.join(pdir, f)).size); } catch {}
    }
  }
  const store = new Map(); // id -> bytes
  let uf = []; try { uf = fs.readdirSync(USAGE_DIR); } catch {}
  for (const f of uf) {
    const m = /^usage-\d{4}-\d{2}-\d{2}-(.+)\.ndjson$/.exec(f);
    if (m) { try { store.set(m[1], (store.get(m[1]) || 0) + fs.statSync(path.join(USAGE_DIR, f)).size); } catch {} }
  }
  const ids = [...new Set([...tx.keys(), ...store.keys()])]
    .map((id) => ({ id, tx: tx.get(id) || 0, store: store.get(id) || 0 }))
    .filter((r) => r.tx && r.store) // present in BOTH = auditable
    .sort((a, b) => b.store - a.store);
  console.log(`Auditable sessions (present in raw transcript AND store), largest first:\n`);
  console.log('  store(KB)  transcript(KB)  sessionId');
  for (const r of ids.slice(0, 25)) {
    console.log(`  ${String(Math.round(r.store / 1024)).padStart(8)}  ${String(Math.round(r.tx / 1024)).padStart(13)}  ${r.id}`);
  }
}

// ---------------- main ----------------
if (args.list || !args.session) {
  if (!args.session) console.log('(no --session given; listing candidates)\n');
  listSessions();
  process.exit(0);
}

const main = findMain(args.session);
if (!main) { console.error(`No transcript under ${PROJECTS} for session "${args.session}"`); process.exit(1); }
const sessionId = main.id;

// TRUTH: union of main + subagent assistant lines, deduped by requestId (last-wins).
// A requestId is one API call; if it appears both as a main sidechain line and in a
// subagent file, it collapses to one (counted once) — assumption-free.
const truth = new Map();
const mainRows = readRawAssistant(main.file);
for (const r of mainRows) truth.set(r.requestId, { ...r, src: r.isSidechain ? 'main-sidechain' : 'main' });
const subFiles = subagentFiles(main);
let subRowCount = 0;
for (const sf of subFiles) {
  const rows = readRawAssistant(sf); subRowCount += rows.length;
  for (const r of rows) truth.set(r.requestId, { ...r, src: 'subagent' });
}

// OURS: dedup by usageId (last-wins) — mirrors readUsageForDates' sessionId\0usageId map.
const { recs: ourRecs, partitions } = readOurStore(sessionId);
const ours = new Map();
for (const rec of ourRecs) ours.set(rec.usageId, rec);

// ---- totals ----
const truthTot = emptyU(); for (const v of truth.values()) addU(truthTot, v.u);
const ourTot = emptyU(); for (const rec of ours.values()) addU(ourTot, ourUsage(rec));

// ---- set reconciliation on requestId ----
const missing = [...truth.keys()].filter((k) => !ours.has(k)); // in raw, not captured -> UNDER
const extra = [...ours.keys()].filter((k) => !truth.has(k));    // captured, not in raw -> OVER/phantom
const shared = [...truth.keys()].filter((k) => ours.has(k));
const mismatched = [];
for (const k of shared) {
  const a = truth.get(k).u, b = ourUsage(ours.get(k));
  if (a.input !== b.input || a.output !== b.output || a.read !== b.read || (a.write5m + a.write1h) !== b.write5m) {
    mismatched.push({ k, a, b });
  }
}

// ---- effective / raw / $ ----
const truthEff = [...truth.values()].reduce((s, v) => s + effectiveOf(v.u), 0);
const ourEff = [...ours.values()].reduce((s, r) => s + effectiveOf(ourUsage(r)), 0);
const truthRaw = rawTotalOf(truthTot);
const ourRaw = rawTotalOf(ourTot);
const truthDollars = [...truth.values()].reduce((s, v) => s + dollarsFor(v.u, v.model, v.timestamp), 0);

// ---- per-model (truth) ----
const byModel = new Map();
for (const v of truth.values()) {
  const fam = familyOf(v.model);
  const e = byModel.get(fam) ?? { fam, count: 0, u: emptyU(), dollars: 0, sampleModel: v.model, at: v.timestamp };
  e.count++; addU(e.u, v.u); e.dollars += dollarsFor(v.u, v.model, v.timestamp);
  byModel.set(fam, e);
}

// ---- main vs subagent split ----
const truthSplit = { main: emptyU(), 'main-sidechain': emptyU(), subagent: emptyU() };
for (const v of truth.values()) addU(truthSplit[v.src], v.u);
const ourSplit = { 'main-agent': emptyU(), subagent: emptyU() };
for (const rec of ours.values()) addU(ourSplit[rec.source === 'subagent' ? 'subagent' : 'main-agent'], ourUsage(rec));

// ================= REPORT =================
line('=');
console.log(`SESSION  ${sessionId}`);
line('=');
console.log(`transcript : ${main.file}`);
console.log(`subagents  : ${subFiles.length} file(s)  (${subRowCount} assistant rows)`);
console.log(`store      : ${partitions.length} partition(s) -> ${partitions.join(', ') || '(none)'}`);
console.log('');

line();
console.log('1) CAPTURE PARITY  (raw transcript requestIds  vs  our store)');
line();
console.log(`raw unique requests : ${n(truth.size)}`);
console.log(`our stored records  : ${n(ours.size)}`);
console.log(`shared              : ${n(shared.length)}`);
console.log(`missing (raw, not captured) : ${n(missing.length)}   <- under-count risk`);
console.log(`extra   (captured, not raw) : ${n(extra.length)}   <- over-count risk`);
console.log(`value mismatches on shared  : ${n(mismatched.length)}`);
if (missing.length) console.log(`   e.g. missing: ${missing.slice(0, 5).join(', ')}`);
if (extra.length) console.log(`   e.g. extra:   ${extra.slice(0, 5).join(', ')}`);
for (const m of mismatched.slice(0, 8)) {
  console.log(`   ~ ${m.k}`);
  console.log(`       raw : in=${m.a.input} out=${m.a.output} read=${m.a.read} create=${m.a.write5m + m.a.write1h}`);
  console.log(`       our : in=${m.b.input} out=${m.b.output} read=${m.b.read} create=${m.b.write5m + m.b.write1h}`);
}
console.log('');

line();
console.log('2) RAW TOKEN TOTALS BY TYPE  (truth vs our store)');
line();
const rows = [
  ['input', truthTot.input, ourTot.input],
  ['output', truthTot.output, ourTot.output],
  ['cache read', truthTot.read, ourTot.read],
  ['cache create', truthTot.write5m + truthTot.write1h, ourTot.write5m + ourTot.write1h],
];
console.log('  type            truth            ours             delta');
for (const [lbl, tr, ou] of rows) {
  console.log(`  ${lbl.padEnd(14)} ${n(tr).padStart(14)}   ${n(ou).padStart(14)}   ${(ou - tr === 0 ? 'exact' : n(ou - tr))}`);
}
console.log(`  ${'RAW TOTAL'.padEnd(14)} ${n(truthRaw).padStart(14)}   ${n(ourRaw).padStart(14)}   ${(ourRaw - truthRaw === 0 ? 'exact' : n(ourRaw - truthRaw))}`);
console.log('');

line();
console.log('3) DASHBOARD UNIT  (effective tokens)  vs RAW  vs  $');
line();
console.log(`raw tokens (sum of 4 types) : ${n(truthRaw)}`);
console.log(`effective tokens (Spend)    : ${n(truthEff)}   <- what the dashboard shows`);
console.log(`   effective / raw          : ${(truthEff / truthRaw).toFixed(2)}x  (${pct(truthEff / truthRaw - 1)} vs raw)`);
console.log(`our-store effective (Spend) : ${n(ourEff)}   delta vs truth ${pct(ourEff / truthEff - 1)}`);
console.log('');
console.log(`ground-truth cost (per-model pricing) : ${usd(truthDollars)}`);
console.log('');

line();
console.log('4) PER-MODEL (truth)  +  effective<->$ identity check');
line();
console.log('  family   reqs        raw          effective        $        eff x baseIn   ');
for (const e of byModel.values()) {
  const base = pricesFor(e.fam, e.at).input;
  const eff = effectiveOf(e.u);
  const implied = eff * base / 1e6; // effective weights track cost ratios, so this == $ exactly...
  // ...unless a family's rows straddle a pricing-window date boundary (one representative base).
  const flag = Math.abs(implied - e.dollars) < 1e-6 ? 'exact' : `Δ ${usd(e.dollars - implied)} (rate-window)`;
  console.log(`  ${e.fam.padEnd(8)} ${String(e.count).padStart(4)}  ${n(rawTotalOf(e.u)).padStart(12)}  ${n(eff).padStart(14)}  ${usd(e.dollars).padStart(9)}  ${usd(implied).padStart(9)}  ${flag}`);
}
console.log('');

line();
console.log('5) MAIN vs SUBAGENT split');
line();
console.log(`truth main        : raw ${n(rawTotalOf(truthSplit.main)).padStart(12)}   eff ${n(effectiveOf(truthSplit.main)).padStart(12)}`);
console.log(`truth main-sidech : raw ${n(rawTotalOf(truthSplit['main-sidechain'])).padStart(12)}   eff ${n(effectiveOf(truthSplit['main-sidechain'])).padStart(12)}   (sidechain lines w/o their own subagent file)`);
console.log(`truth subagent    : raw ${n(rawTotalOf(truthSplit.subagent)).padStart(12)}   eff ${n(effectiveOf(truthSplit.subagent)).padStart(12)}`);
console.log(`our  main-agent   : raw ${n(rawTotalOf(ourSplit['main-agent'])).padStart(12)}   eff ${n(effectiveOf(ourSplit['main-agent'])).padStart(12)}`);
console.log(`our  subagent     : raw ${n(rawTotalOf(ourSplit.subagent)).padStart(12)}   eff ${n(effectiveOf(ourSplit.subagent)).padStart(12)}`);
console.log('');

line('=');
console.log('VERDICT');
line('=');
const capOk = missing.length === 0 && extra.length === 0 && mismatched.length === 0;
console.log(capOk
  ? '* CAPTURE: our store reproduces the raw transcript EXACTLY (same requests, same per-type values).'
  : `* CAPTURE: divergence — ${missing.length} missing, ${extra.length} extra, ${mismatched.length} value-mismatched.`);
console.log(`* SPEND IS NOT RAW: effective tokens are ${(truthEff / truthRaw).toFixed(2)}x the raw token count`);
console.log(`  (output weighted 5x, cache-create 1.25x, cache-read 0.1x). This is the "looks inflated" gap.`);
console.log(`* COST FAITHFUL: effective tokens map to ${usd(truthDollars)} via per-model base rates.`);
console.log('');
