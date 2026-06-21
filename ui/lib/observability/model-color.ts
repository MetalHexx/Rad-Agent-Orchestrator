// Categorical model → house color-token mapping (DD-1, DD-2). The actual colors live as CSS
// custom properties in globals.css (--model-*, light + dark). No inline color values here —
// this module returns token NAMES only; the component renders var(<token>) (NFR-2).

export const MODEL_TOKENS = [
  "--model-red", "--model-amber", "--model-green", "--model-blue",
  "--model-purple", "--model-teal", "--model-pink", "--model-grey",
] as const;

export type ModelToken = typeof MODEL_TOKENS[number];

const MODEL_COLOR_MAP: Record<string, ModelToken> = {
  opus: "--model-red",
  sonnet: "--model-amber",   // the execution yellowy-orange hue
  haiku: "--model-green",
};

/** Resolve a harness-specific model id to a stable slot key (DD-2). */
export function normalizeModel(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes("opus")) return "opus";
  if (m.includes("sonnet")) return "sonnet";
  if (m.includes("haiku")) return "haiku";
  return m;
}

/** Map a model id to a house color token; unmapped models get a deterministic slot (DD-2, NFR-1). */
export function modelColor(raw: string): ModelToken {
  const key = normalizeModel(raw);
  const mapped = MODEL_COLOR_MAP[key];
  if (mapped) return mapped;
  const h = [...key].reduce((acc, ch) => acc + ch.charCodeAt(0), 0); // stable, simple hash
  return MODEL_TOKENS[h % MODEL_TOKENS.length];
}
