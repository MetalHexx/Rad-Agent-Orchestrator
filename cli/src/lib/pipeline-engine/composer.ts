import fs from 'node:fs';
import path from 'node:path';
import { parseActionEventFile } from './action-event-loader.js';
import type { EventFrontmatter } from './action-event-loader.js';

export interface ComposeInput {
  actionName: string;
  completionEvent: string | null;
  catalogRoot: string;
  overlay?: Record<string, string>;
  /** Starting step number. Defaults to 1. The engine's orphan-prepend path
   *  uses startStep: 2 so the prepended orphan-post can occupy Step 1. */
  startStep?: number;
  /** Rendered guidance for the commands on the envelope, closing the completion
   *  section. Absent on preview surfaces and wherever no command is composed
   *  for the orchestrator to run — those get the shape-only block instead. */
  signalGuidance?: string;
}

export interface ComposeResult {
  prompt: string;
  has_custom_instructions: boolean;
}

function readBodyIfExists(filePath: string, filename: string, kind: 'action' | 'event'): string | null {
  if (!fs.existsSync(filePath)) return null;
  const text = fs.readFileSync(filePath, 'utf8');
  const parsed = parseActionEventFile(text, filename);
  if (parsed.kind !== kind) {
    throw new Error(`Catalog file '${filePath}' parsed kind '${parsed.kind}' but kind '${kind}' expected.`);
  }
  return parsed.body;
}

function readEvent(filePath: string, filename: string): { body: string; fm: EventFrontmatter } | null {
  if (!fs.existsSync(filePath)) return null;
  const text = fs.readFileSync(filePath, 'utf8');
  const parsed = parseActionEventFile(text, filename);
  if (parsed.kind !== 'event') {
    throw new Error(`Catalog file '${filePath}' expected to be an event but kind was '${parsed.kind}'.`);
  }
  return { body: parsed.body, fm: parsed.frontmatter as EventFrontmatter };
}

function validateCustomSlot(
  customFile: string,
  catalogFile: string,
  customFilename: string,
  catalogFilename: string,
  kind: 'action' | 'event',
  catalogRoot: string,
): void {
  if (fs.existsSync(customFile) && !fs.existsSync(catalogFile)) {
    throw new Error(
      `Composer validation: custom '${customFilename}' references unknown ${kind} — ` +
      `expected catalog file '${catalogFilename}' under '${catalogRoot}'.`,
    );
  }
}

function makeCustomReader(overlay: Record<string, string> | undefined) {
  return (filePath: string, overlayKey: string): string | null => {
    if (overlay && Object.prototype.hasOwnProperty.call(overlay, overlayKey)) {
      const v = overlay[overlayKey];
      return v === '' ? null : v;
    }
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf8');
  };
}

/** Shape-only completion block: the event to send and the flags it accepts,
 *  with no rendered command. Used wherever the caller supplies no guidance —
 *  the `action-events compose` preview surfaces, and actions another skill
 *  signals. */
function staticSignalBlock(eventName: string, fm: EventFrontmatter): string {
  const entries = Object.entries(fm.signal_payload ?? {});
  const head = `Completion event: \`${eventName}\`.`;
  if (entries.length === 0) return `${head} It takes no payload flags.`;
  const flags = entries.map(([flag, def]) => (
    `- \`--${flag}\`${def.array ? ' (JSON array)' : ''} — ${def.description}`
  ));
  return [`${head} Payload flags:`, ...flags].join('\n');
}

function trimBody(s: string): string {
  return s.replace(/^\s*\n+/, '').replace(/\n+\s*$/, '');
}

// The new admission helper: returns the admitted body or null. The Step
// heading is assigned by the caller based on a running counter so empty
// slots collapse without consuming a number (FR-1, AD-1).
// Whitespace-only content (including lone spaces without newlines) is treated
// as absent so has_custom_instructions is not set for blank overlays.
function admit(body: string | null): string | null {
  if (!body) return null;
  const trimmed = trimBody(body);
  return trimmed.trim() ? trimmed : null;
}

interface Section { body: string; isOverlay: boolean }

function emit(sections: Section[], startStep: number): { prompt: string; has_custom_instructions: boolean } {
  const lines: string[] = [];
  let step = startStep;
  let hadOverlay = false;
  for (const s of sections) {
    lines.push(`## Step ${step}`);
    lines.push(s.body);
    if (s.isOverlay) hadOverlay = true;
    step += 1;
  }
  return { prompt: lines.join('\n\n'), has_custom_instructions: hadOverlay };
}

export function composeActionPrompt(input: ComposeInput): ComposeResult {
  const { actionName, completionEvent, catalogRoot } = input;
  const startStep = input.startStep ?? 1;
  const customRoot = path.join(catalogRoot, 'custom');
  const readCustom = makeCustomReader(input.overlay);
  const sections: Section[] = [];

  const actionCustomPre = path.join(customRoot, `action.${actionName}.pre.md`);
  const actionCatalog = path.join(catalogRoot, `action.${actionName}.md`);
  validateCustomSlot(actionCustomPre, actionCatalog,
    `custom/action.${actionName}.pre.md`, `action.${actionName}.md`, 'action', catalogRoot);

  const actionPre = admit(readCustom(actionCustomPre, `action.${actionName}.pre`));
  if (actionPre !== null) sections.push({ body: actionPre, isOverlay: true });

  const actionBody = readBodyIfExists(actionCatalog, `action.${actionName}.md`, 'action');
  if (actionBody === null) {
    throw new Error(
      `Composer validation: expected catalog file 'action.${actionName}.md' under '${catalogRoot}'.`,
    );
  }
  const actionBodyAdmitted = admit(actionBody);
  if (actionBodyAdmitted !== null) sections.push({ body: actionBodyAdmitted, isOverlay: false });

  if (completionEvent !== null) {
    const eventCustomPre = path.join(customRoot, `event.${completionEvent}.pre.md`);
    const eventCatalog = path.join(catalogRoot, `event.${completionEvent}.md`);
    const eventCustomPost = path.join(customRoot, `event.${completionEvent}.post.md`);
    validateCustomSlot(eventCustomPre, eventCatalog,
      `custom/event.${completionEvent}.pre.md`, `event.${completionEvent}.md`, 'event', catalogRoot);
    validateCustomSlot(eventCustomPost, eventCatalog,
      `custom/event.${completionEvent}.post.md`, `event.${completionEvent}.md`, 'event', catalogRoot);

    const eventPre = admit(readCustom(eventCustomPre, `event.${completionEvent}.pre`));
    if (eventPre !== null) sections.push({ body: eventPre, isOverlay: true });

    const evt = readEvent(eventCatalog, `event.${completionEvent}.md`);
    if (!evt) {
      throw new Error(
        `Composer validation: expected catalog file 'event.${completionEvent}.md' under '${catalogRoot}'.`,
      );
    }
    const guidance = input.signalGuidance?.trim()
      ? input.signalGuidance.trim()
      : staticSignalBlock(completionEvent, evt.fm);
    const whenCompleteBody = trimBody(evt.body) + '\n\n' + guidance;
    const whenAdmitted = admit(whenCompleteBody);
    if (whenAdmitted !== null) sections.push({ body: whenAdmitted, isOverlay: false });

    const eventPost = admit(readCustom(eventCustomPost, `event.${completionEvent}.post`));
    if (eventPost !== null) sections.push({ body: eventPost, isOverlay: true });
  }

  return emit(sections, startStep);
}

export interface OrphanRuntimeShapeInput {
  eventName: string;
  catalogRoot: string;
  overlay?: Record<string, string>;
}

export const NEXT_ACTION_PLACEHOLDER = `← the next action's prompt is composed here at runtime`;

/**
 * Emits the runtime shape that the engine's orphan-prepend path delivers
 * — the orphan-post overlay rendered under ## Step 1, followed by a
 * placeholder line. Used by both the engine (FR-3) and the CLI compose
 * command's runtime-orphan mode (FR-19, FR-20) so preview and runtime
 * emit identical bytes.
 */
export function composeOrphanRuntimeShape(input: OrphanRuntimeShapeInput): ComposeResult {
  const { eventName, catalogRoot, overlay } = input;
  const customRoot = path.join(catalogRoot, 'custom');
  const readCustom = makeCustomReader(overlay);
  const eventCustomPost = path.join(customRoot, `event.${eventName}.post.md`);
  const post = admit(readCustom(eventCustomPost, `event.${eventName}.post`));
  if (post !== null) {
    return {
      prompt: `## Step 1\n\n${post}\n\n${NEXT_ACTION_PLACEHOLDER}`,
      has_custom_instructions: true,
    };
  }
  return {
    prompt: `(no overlay content)\n\n${NEXT_ACTION_PLACEHOLDER}`,
    has_custom_instructions: false,
  };
}

export interface OrphanComposeInput {
  eventName: string;
  catalogRoot: string;
  overlay?: Record<string, string>;
  startStep?: number;
}

export function composeOrphanEventPrompt(input: OrphanComposeInput): ComposeResult {
  const { eventName, catalogRoot, overlay } = input;
  const startStep = input.startStep ?? 1;
  const customRoot = path.join(catalogRoot, 'custom');
  const readCustom = makeCustomReader(overlay);
  const sections: Section[] = [];

  const eventCatalog = path.join(catalogRoot, `event.${eventName}.md`);
  const eventCustomPre = path.join(customRoot, `event.${eventName}.pre.md`);
  const eventCustomPost = path.join(customRoot, `event.${eventName}.post.md`);

  validateCustomSlot(eventCustomPre, eventCatalog,
    `custom/event.${eventName}.pre.md`, `event.${eventName}.md`, 'event', catalogRoot);
  validateCustomSlot(eventCustomPost, eventCatalog,
    `custom/event.${eventName}.post.md`, `event.${eventName}.md`, 'event', catalogRoot);

  const eventPre = admit(readCustom(eventCustomPre, `event.${eventName}.pre`));
  if (eventPre !== null) sections.push({ body: eventPre, isOverlay: true });

  const evt = readEvent(eventCatalog, `event.${eventName}.md`);
  if (!evt) {
    throw new Error(`Composer validation: expected catalog file 'event.${eventName}.md' under '${catalogRoot}'.`);
  }
  const whenCompleteBody = trimBody(evt.body) + '\n\n' + staticSignalBlock(eventName, evt.fm);
  const whenAdmitted = admit(whenCompleteBody);
  if (whenAdmitted !== null) sections.push({ body: whenAdmitted, isOverlay: false });

  const eventPost = admit(readCustom(eventCustomPost, `event.${eventName}.post`));
  if (eventPost !== null) sections.push({ body: eventPost, isOverlay: true });

  return emit(sections, startStep);
}
