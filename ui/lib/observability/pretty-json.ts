// pretty-json.ts — tokenizes a JSON value into classed spans for syntax-highlighted rendering.
// Uses only house design tokens (Tailwind semantic classes) — never literal hex colors (NFR-4).
// Truncated body markers (truncated, fullBytes) render verbatim via JSON.stringify (FR-8).

export type TokenKind = 'key' | 'string' | 'number' | 'literal' | 'punct';

export interface JsonToken {
  kind: TokenKind;
  text: string;
  className?: string;
}

// House token class map — semantic Tailwind classes only, never hex (NFR-4).
const CLASS_MAP: Record<TokenKind, string> = {
  key:     'text-foreground font-medium',
  string:  'text-muted-foreground',
  number:  'text-chart-2',
  literal: 'text-chart-4',
  punct:   'text-muted-foreground/70',
};

/**
 * Tokenizes any JSON-serializable value into an array of typed tokens suitable
 * for rendering as syntax-highlighted spans (FR-7).
 *
 * Because the full value is stringified up-front, any TruncatableBody fields
 * (truncated, fullBytes, etc.) appear verbatim with no special handling (FR-8).
 */
export function tokenizeJson(value: unknown): JsonToken[] {
  const json = JSON.stringify(value, null, 2);
  const tokens: JsonToken[] = [];

  // Walk the JSON string character by character, extracting tokens.
  let i = 0;
  while (i < json.length) {
    const ch = json[i];

    // Whitespace — emit as punct so whitespace is preserved in the rendered output
    if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') {
      let ws = '';
      while (i < json.length && (json[i] === ' ' || json[i] === '\n' || json[i] === '\r' || json[i] === '\t')) {
        ws += json[i++];
      }
      tokens.push({ kind: 'punct', text: ws, className: CLASS_MAP['punct'] });
      continue;
    }

    // Structural punctuation: { } [ ] , :
    if (ch === '{' || ch === '}' || ch === '[' || ch === ']' || ch === ',' || ch === ':') {
      tokens.push({ kind: 'punct', text: ch, className: CLASS_MAP['punct'] });
      i++;
      continue;
    }

    // String — could be a key or a string value; we determine key vs value by
    // checking if the next non-whitespace+colon sequence indicates a key position.
    if (ch === '"') {
      const start = i;
      i++; // skip opening quote
      while (i < json.length) {
        if (json[i] === '\\') {
          i += 2; // skip escape sequence
        } else if (json[i] === '"') {
          i++; // skip closing quote
          break;
        } else {
          i++;
        }
      }
      const raw = json.slice(start, i);

      // Determine if this string is a key by peeking at what follows (ignoring whitespace).
      let j = i;
      while (j < json.length && (json[j] === ' ' || json[j] === '\n' || json[j] === '\r' || json[j] === '\t')) {
        j++;
      }
      const isKey = json[j] === ':';

      const kind: TokenKind = isKey ? 'key' : 'string';
      tokens.push({ kind, text: raw, className: CLASS_MAP[kind] });
      continue;
    }

    // Number
    if ((ch >= '0' && ch <= '9') || ch === '-') {
      let num = '';
      while (i < json.length && (json[i] === '-' || json[i] === '+' || json[i] === '.' ||
             json[i] === 'e' || json[i] === 'E' || (json[i] >= '0' && json[i] <= '9'))) {
        num += json[i++];
      }
      tokens.push({ kind: 'number', text: num, className: CLASS_MAP['number'] });
      continue;
    }

    // Literals: true, false, null
    if (json.startsWith('true', i)) {
      tokens.push({ kind: 'literal', text: 'true', className: CLASS_MAP['literal'] });
      i += 4;
      continue;
    }
    if (json.startsWith('false', i)) {
      tokens.push({ kind: 'literal', text: 'false', className: CLASS_MAP['literal'] });
      i += 5;
      continue;
    }
    if (json.startsWith('null', i)) {
      tokens.push({ kind: 'literal', text: 'null', className: CLASS_MAP['literal'] });
      i += 4;
      continue;
    }

    // Fallback: emit any unrecognised character as punct
    tokens.push({ kind: 'punct', text: ch, className: CLASS_MAP['punct'] });
    i++;
  }

  return tokens;
}
