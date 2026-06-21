export function niceMax(values: number[]): number {
  const max = Math.max(0, ...values);
  if (max <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(max)));
  const n = max / pow;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return nice * pow;
}

/** Round a positive number to the NEAREST "nice" tick value (1, 2, 2.5, 5, 10 × 10ⁿ) on a log scale.
 *  Nearest (not round-up) keeps the gridline count close to the target instead of going sparse. */
function niceStep(rough: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const n = rough / pow; // [1, 10)
  // geometric midpoints between the nice rungs: √2, √5, √12.5, √50
  const nice = n < 1.414 ? 1 : n < 2.236 ? 2 : n < 3.536 ? 2.5 : n < 7.071 ? 5 : 10;
  return nice * pow;
}

const Y_AXIS_PADDING = 0.05; // a little headroom above the peak so the top line doesn't touch the edge

/** Grafana/D3-style axis. The ceiling HUGS the data peak — `peak * (1 + padding)`, a little headroom,
 *  NOT a coarse round-up — so lines nearly fill the panel (a 124k peak tops out ~130k, not 150k/200k).
 *  Gridlines are nice, evenly-stepped INTEGER values from 0 up to the highest nice multiple ≤ the peak;
 *  the top gridline may sit just under the peak (the standard tight look). Steps are whole numbers
 *  (token counts are integers) so labels never render fractional/duplicate, and a non-finite /
 *  non-positive peak falls back to a clean 0..4 axis (never the duplicate "0 0 1 1 1"). */
export function niceAxis(dataMax: number, targetTicks: number): { max: number; ticks: number[] } {
  const intervals = Math.max(1, targetTicks - 1);
  if (!Number.isFinite(dataMax) || dataMax <= 0) {
    return { max: intervals, ticks: Array.from({ length: intervals + 1 }, (_, i) => i) };
  }
  const step = Math.max(1, Math.round(niceStep(dataMax / intervals)));
  const max = dataMax * (1 + Y_AXIS_PADDING); // tight ceiling — just a little padding above the peak
  const count = Math.floor(dataMax / step) + 1; // gridlines 0..(highest nice multiple ≤ peak)
  return { max, ticks: Array.from({ length: count }, (_, i) => i * step) };
}
