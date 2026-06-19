import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const css = readFileSync(path.join(process.cwd(), 'app', 'globals.css'), 'utf-8');

test('defines the semantic --space-1..6 scale on a 4px base (DD-1)', () => {
  const expected: Array<[string, string]> = [
    ['--space-1', '4px'], ['--space-2', '8px'], ['--space-3', '12px'],
    ['--space-4', '16px'], ['--space-5', '24px'], ['--space-6', '32px'],
  ];
  for (const [name, value] of expected) {
    assert.match(css, new RegExp(`${name}\\s*:\\s*${value}\\s*;`), `${name}: ${value} present`);
  }
});
