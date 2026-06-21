export function niceMax(values: number[]): number {
  const max = Math.max(0, ...values);
  if (max <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(max)));
  const n = max / pow;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return nice * pow;
}

/** Round a single positive number UP to a "nice" value (1, 2, 2.5, 5, 10 × 10ⁿ) — the tick-step
 *  primitive that shares niceMax's ladder. */
function roundUpNice(x: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(x)));
  const n = x / pow;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return nice * pow;
}

/** Grafana/D3-style axis: a tight ceiling + nice, evenly-stepped ticks that fit `dataMax` snugly.
 *  Targets ~`targetTicks` ticks but lets the count flex (≈4–6) so the ceiling hugs the data instead
 *  of the coarse round-up `niceMax` does (150k → 150k, not 200k). The step is a whole number ≥ 1
 *  (token counts are integers), so ticks never render fractional/duplicate labels and an empty/tiny
 *  window yields distinct integer ticks (0,1,2,3,4) rather than the duplicate "0 0 1 1 1" a fixed
 *  5-tick humanized axis produces. Non-finite / non-positive peaks fall back to that clean 0..4 axis. */
export function niceAxis(dataMax: number, targetTicks: number): { max: number; ticks: number[] } {
  const intervals = Math.max(1, targetTicks - 1);
  if (!Number.isFinite(dataMax) || dataMax <= 0) {
    return { max: intervals, ticks: Array.from({ length: intervals + 1 }, (_, i) => i) };
  }
  // Round the nice step UP to a whole number. Token counts are integers, and the 2.5 ladder rung at
  // pow=1 (dataMax 9–10) would otherwise give a 2.5 step → fractional ticks [0,2.5,5,7.5,10] that
  // humanize to mislabeled gridlines (0,3,5,8,10). Math.ceil only bites that tiny case (2.5→3); at
  // larger scales the nice step is already integral (25, 250, 25_000, …), so the tight fit is intact.
  const step = Math.max(1, Math.ceil(roundUpNice(dataMax / intervals)));
  const max = Math.ceil(dataMax / step) * step; // smallest whole-step multiple ≥ dataMax
  const count = Math.round(max / step) + 1;
  return { max, ticks: Array.from({ length: count }, (_, i) => i * step) };
}
