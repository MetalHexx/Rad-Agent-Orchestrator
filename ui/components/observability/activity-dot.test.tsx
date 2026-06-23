import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ActivityDot } from './activity-dot';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;

test('a fresh dot glows (pulse class) and rests at full live-accent (FR-12, DD-7)', () => {
  const html = renderToStaticMarkup(createElement(ActivityDot, { msSinceActivity: 0 }));
  assert.ok(html.includes('activity-dot-pulse'), 'fresh dot has the pulse class');
  assert.ok(html.includes('var(--live-accent) 100%'), 'fresh dot rests at full lavender');
});

test('an idle dot does not pulse and rests at grey (FR-12, DD-7)', () => {
  const html = renderToStaticMarkup(createElement(ActivityDot, { msSinceActivity: 10 * 60 * 1000 }));
  assert.ok(!html.includes('activity-dot-pulse'), 'idle dot has no pulse class');
  assert.ok(html.includes('var(--live-accent) 0%'), 'idle dot rests at grey');
});

test('the glow keyframe is a pure blurred halo with NO hard ring (DD-7)', () => {
  const css = readFileSync(path.join(process.cwd(), 'app', 'globals.css'), 'utf-8');
  const start = css.indexOf('@keyframes activity-dot-glow-kf');
  assert.ok(start !== -1, 'activity-dot-glow-kf keyframe exists');
  const block = css.slice(start, css.indexOf('}', css.indexOf('}', start) + 1) + 1);
  assert.doesNotMatch(block, /box-shadow:\s*0 0 0 /, 'must NOT use a zero-blur hard-ring spread');
  assert.match(css, /\.activity-dot-pulse[^}]*activity-dot-glow-kf[^;]*infinite/, 'pulse class loops the glow');
});

test('a model-colored dot fills + glows in the provided color, bypassing the lavender decay (FR-1, AD-2, DD-2)', () => {
  const fresh = renderToStaticMarkup(createElement(ActivityDot, { msSinceActivity: 0, color: 'var(--model-red)' }));
  assert.ok(fresh.includes('activity-dot-pulse'), 'active model dot pulses');
  assert.ok(fresh.includes('var(--model-red)'), 'fill adopts the provided color');
  assert.ok(fresh.includes('--activity-dot-glow-color'), 'glow color set as a custom property');
  assert.ok(!fresh.includes('var(--live-accent)'), 'color path does not emit the lavender resting color');

  const idle = renderToStaticMarkup(createElement(ActivityDot, { msSinceActivity: 10 * 60 * 1000, color: 'var(--model-red)' }));
  assert.ok(!idle.includes('activity-dot-pulse'), 'idle model dot does not pulse');
  assert.ok(idle.includes('var(--model-red)'), 'idle model dot stays solid in its color (no decay to grey)');
});

test('the glow keyframe is parameterized with a lavender fallback (AD-1, NFR-3)', () => {
  const css = readFileSync(path.join(process.cwd(), 'app', 'globals.css'), 'utf-8');
  assert.match(css, /--activity-dot-glow-color,\s*var\(--live-accent\)/, 'keyframe reads the per-instance color with a lavender fallback');
});
