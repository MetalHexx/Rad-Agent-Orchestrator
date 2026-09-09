// cli/tests/behavioral/pipeline/helpers/prompt.ts
//
// Shared assertion helper for the per-envelope `data.prompt`,
// `data.completion_event` and `data.completion_commands` contract. Every
// successful pipeline envelope under behavioral/pipeline/events/ carries these
// fields. A non-terminal action carries a runnable command for the completion
// event the orchestrator is expected to signal next; a terminal action (e.g.
// display_halted, display_complete) carries `completion_event: null` and an
// empty command array.

import fs from 'node:fs';
import path from 'node:path';
import { expect } from 'vitest';
import { realCatalogRoot } from './catalog.js';

type Envelope = { ok: boolean; data?: unknown; error?: unknown };

function getData(env: Envelope): Record<string, unknown> {
  expect(env.ok, 'envelope.ok').toBe(true);
  const data = env.data as Record<string, unknown> | undefined;
  expect(data, 'envelope.data').toBeDefined();
  expect(data, 'envelope.data shape').toBeTypeOf('object');
  return data!;
}

type CompletionCommandRow = { event?: unknown; command?: unknown; when?: unknown };

function completionCommands(data: Record<string, unknown>): CompletionCommandRow[] {
  expect(data, 'data should carry completion_commands').toHaveProperty('completion_commands');
  const commands = data['completion_commands'];
  expect(Array.isArray(commands), 'data.completion_commands is an array').toBe(true);
  return commands as CompletionCommandRow[];
}

/** Assert the envelope's prompt + completion_event + completion_commands
 *  contract for a NON-terminal action. All three live at the top level of
 *  `data` (alongside `action` and `context`). Anchors:
 *    - data.prompt is a non-empty string
 *    - data.completion_event === expectedEvent
 *    - data.completion_commands carries a runnable command for expectedEvent,
 *      or is empty when another skill — not the orchestrator — sends the event */
export function assertPromptForEvent(env: Envelope, expectedEvent: string): void {
  const data = getData(env);
  expect(data, 'data should carry prompt').toHaveProperty('prompt');
  expect(typeof data['prompt'], 'data.prompt typeof').toBe('string');
  expect((data['prompt'] as string).length, 'data.prompt.length').toBeGreaterThan(0);
  expect(data, 'data should carry completion_event').toHaveProperty('completion_event');
  expect(data['completion_event'], 'data.completion_event').toBe(expectedEvent);
  const commands = completionCommands(data);
  if (catalogSignalledBySkill(data['action'] as string)) {
    expect(commands, 'skill-signalled action composes no command').toEqual([]);
    return;
  }
  const match = commands.find((c) => c.event === expectedEvent);
  expect(match, `completion_commands should carry an entry for ${expectedEvent}`).toBeDefined();
  expect(typeof match!.command, 'entry.command typeof').toBe('string');
  expect((match!.command as string).length, 'entry.command.length').toBeGreaterThan(0);
}

/** Assert the envelope's prompt + completion_event + completion_commands
 *  contract for a TERMINAL action: `data.completion_event: null` and an empty
 *  command array — there is nothing left to signal. */
export function assertPromptForTerminalAction(env: Envelope): void {
  const data = getData(env);
  expect(data, 'data should carry prompt').toHaveProperty('prompt');
  expect(typeof data['prompt'], 'data.prompt typeof').toBe('string');
  expect((data['prompt'] as string).length, 'data.prompt.length').toBeGreaterThan(0);
  expect(data, 'data should carry completion_event').toHaveProperty('completion_event');
  expect(data['completion_event'], 'data.completion_event').toBeNull();
  expect(completionCommands(data), 'terminal completion_commands').toEqual([]);
}

/** Read the catalog's `action.<name>.md` frontmatter and return its
 *  `completion_event` value. Used by behavioral tests to ground prompt
 *  assertions in real catalog content (per the handoff: "next downstream
 *  action" rows read the resolved action's `completion_event` from the
 *  seeded catalog file rather than hard-coding it). */
export function catalogCompletionEvent(actionName: string): string | null {
  const file = path.join(realCatalogRoot(), `action.${actionName}.md`);
  const text = fs.readFileSync(file, 'utf8');
  // Minimal frontmatter parse — read the `completion_event:` line. The catalog
  // files follow a strict shape (validated elsewhere) so a substring extractor
  // is sufficient here and avoids pulling in a YAML parser at the assertion
  // surface.
  const match = /^completion_event:\s*(.+)$/m.exec(text);
  if (!match) throw new Error(`catalog file '${file}' has no completion_event line`);
  const raw = match[1]!.trim();
  if (raw === 'null') return null;
  return raw;
}

/** True when the catalog says another skill sends the action's completion
 *  event. Those actions leave `completion_commands` empty — there is no
 *  command for the orchestrator to run. Same minimal line extractor as
 *  `catalogCompletionEvent`. */
export function catalogSignalledBySkill(actionName: string): boolean {
  const file = path.join(realCatalogRoot(), `action.${actionName}.md`);
  const text = fs.readFileSync(file, 'utf8');
  const match = /^completion_signalled_by:\s*(.+)$/m.exec(text);
  return match !== null && match[1]!.trim() === 'skill';
}

/** Branching helper: assert the envelope according to whether the action
 *  resolves to a terminal action (completion_event === null) or a
 *  non-terminal action (completion_event !== null). The action name is
 *  read directly from the envelope so the assertion stays honest against
 *  catalog drift in P04. */
export function assertPromptForEnvelopeAction(env: Envelope): void {
  const data = env.data as { action?: string | null } | undefined;
  const actionName = data?.action;
  expect(actionName, 'envelope.data.action').toBeDefined();
  if (actionName === null) {
    // No next action — context should be empty; nothing to assert here.
    return;
  }
  const completionEvent = catalogCompletionEvent(actionName as string);
  if (completionEvent === null) assertPromptForTerminalAction(env);
  else assertPromptForEvent(env, completionEvent);
}
