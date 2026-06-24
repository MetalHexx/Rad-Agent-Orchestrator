// Pure, SSR-safe view helpers for the Transcript facet. No React, no DOM.
export function formatClock(ts: string): string {
  const m = /T(\d{2}:\d{2}:\d{2})/.exec(ts);
  return m ? m[1] : "";
}

export function toolArgPreview(text: string | undefined, max = 80): string {
  if (!text) return "";
  const first = text.split("\n")[0].trim();
  return first.length > max ? first.slice(0, max - 1) + "…" : first;
}
