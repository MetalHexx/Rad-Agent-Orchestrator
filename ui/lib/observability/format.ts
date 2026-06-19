/** Compact token humanizer: 4_821_000 → "4.82M", 12_300 → "12.3K". */
export function humanizeTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${Math.round(n)}`;
}
