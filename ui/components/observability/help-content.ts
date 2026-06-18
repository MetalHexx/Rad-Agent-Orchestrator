/**
 * Plain-language help content for the Observability page.
 * Exported as a markdown string so it flows through the house MarkdownRenderer
 * without requiring bundler raw-loader config.
 *
 * Covers: Total Spend / effective tokens, Active Now, Today / Earlier (DD-9).
 */
export const OBSERVABILITY_HELP_MD = `
# About this page

This page shows **system-wide token usage** for all Claude sessions started from your machine.

---

## Total Spend

**Total Spend** is measured in *effective tokens* — not dollar cost.

An effective token is a cache-aware, cost-shaped count: cache hits are weighted cheaply,
cache misses and output tokens are weighted more heavily, so the number reflects relative
cost without being an exact invoice figure.

The total is summed across the **main agent and all subagents** it spawns in a session,
so one "session" may represent many model calls running in parallel.

> **This is not a dollar cost.** It is a cost-shaped proxy useful for comparing sessions
> and spotting unusually expensive runs. Actual billing figures come from your Anthropic
> usage dashboard.

---

## Sessions

A **session** is one continuous Claude run (one \`claude\` process invocation). Each row in
the table below represents a single session with its own ID, worktree path, and token
accumulation.

---

## Active Now

**Active Now** shows how many sessions have sent a token event in the last few minutes.
A glowing green dot means at least one session is currently active; the colour fades
toward grey as activity grows older.

---

## Today / Earlier

By default the page shows data for **Today** (the current UTC day).

Click **Earlier** to step back one day at a time and load historical data. Earlier is
disabled once you reach the oldest retained day (data is kept for a rolling window of
recent days).
`;
