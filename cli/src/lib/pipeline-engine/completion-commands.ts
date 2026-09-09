import type { ActionFrontmatter, EventFrontmatter } from './action-event-loader.js';

type SignalPayload = EventFrontmatter['signal_payload'];

export interface CompletionCommand {
  event: string;
  /** Present only when the returned array has more than one entry. */
  when?: string;
  /** Fully-formed, runnable from any working directory. */
  command: string;
}

export interface CompletionCommandsInput {
  action: ActionFrontmatter;
  /** signal_payload of every event named by the action, keyed by event name.
   *  The caller resolves these from the catalog; a declared event with no
   *  entry here is a hard error, not an empty command. */
  payloads: Record<string, SignalPayload>;
  /** Absolute path to the running radorch script (PathContext.scriptPath). */
  scriptPath: string;
  /** Absolute project directory. */
  projectDir: string;
  /** Flag-name → already-known literal value, e.g. { phase: '1', task: '2' }. */
  known: Record<string, string>;
  /** Flags this invocation must not carry at all — contextually inapplicable,
   *  not merely unknown. A schema-optional flag with no value is normally a
   *  marker for the orchestrator to fill; listing it here says the value will
   *  never exist for this invocation, so the flag is dropped from the command
   *  instead. Deciding that is the caller's job: the renderer is told, not asked.
   *  Absent or empty means nothing is dropped. */
  omit?: readonly string[];
  /** Repo names for array-flag skeletons, in state order. */
  repoNames: string[];
}

const ALL_DIGITS = /^\d+$/;

function marker(name: string): string {
  return `<fill-in: ${name}>`;
}

/** A value the engine already resolved. All-digit values pass through bare;
 *  anything else is double-quoted, because an unquoted multi-word value is
 *  parsed as excess arguments and rejected before the handler runs. */
function renderKnownValue(value: string): string {
  return ALL_DIGITS.test(value) ? value : `"${value}"`;
}

/** One JSON object per repo, `name` pre-filled and every other key left as a
 *  bare marker — bare because the orchestrator substitutes booleans and nulls
 *  as well as strings. Single-quoted to match the existing `--repos`
 *  convention: a literal string in bash and in PowerShell 7+.
 *
 *  Not on Windows PowerShell 5.1, which re-quotes native-command arguments and
 *  drops embedded double quotes whatever the outer quoting — so a substituted
 *  JSON payload arrives unparseable there. Pre-existing and not specific to this
 *  flag; no single literal form satisfies both hosts, so the fix is a transport
 *  change (`@file` or stdin) tracked separately.
 *
 *  With no repo names there is nothing to pre-fill, and `'[]'` would record
 *  nothing while looking like success — so the whole flag becomes one marker
 *  and the guidance block carries the row shape instead. */
function renderArraySkeleton(flag: string, itemKeys: string[], repoNames: string[]): string {
  if (repoNames.length === 0 || itemKeys.length === 0) return `'${marker(flag)}'`;
  const rows = repoNames.map((name) => {
    const pairs = itemKeys.map((key) => (
      key === 'name' ? `"name":${JSON.stringify(name)}` : `"${key}":${marker(key)}`
    ));
    return `{${pairs.join(',')}}`;
  });
  return `'[${rows.join(',')}]'`;
}

/** Whether this flag leaves no trace in the rendered command: no `--flag`, no
 *  marker. A marker would read as "substitute this", and the standing rule
 *  forbids dropping anything the command carries — so carrying an inapplicable
 *  flag at all forces the orchestrator to guess.
 *
 *  `required: true` vetoes the omission. Not because the parser would reject the
 *  command — `pipeline signal` requires only `--event` and `--project-dir`, and
 *  nothing reads these declarations at parse time — but because the mutation
 *  behind a genuinely-required flag treats absence as nothing-to-do and still
 *  reports success. Dropping `--repos` from `pr_created`, for one, marks
 *  `final_pr` completed and records no `pr_url` at all. Silent data loss is
 *  worse than a marker.
 *
 *  The caller decides omission from context alone and cannot see which event's
 *  payload the flag lands in — the same flag name is optional on one event and
 *  required on another (`repos`, across `task_completed` and `pr_created`) — so
 *  the veto belongs here, next to the declaration. */
function isDropped(flag: string, def: { required: boolean }, omit: ReadonlySet<string>): boolean {
  return omit.has(flag) && def.required !== true;
}

/** Whether a rendered command carries this flag. The command text is the ground
 *  truth about what the orchestrator will see, so the guidance reads it back
 *  rather than re-deriving the drop decision — the two cannot then disagree.
 *  Every flag is followed by a value, so the trailing space always exists; the
 *  bounded match is what stops `--project` from matching `--project-dir`. */
function carriesFlag(command: string, flag: string): boolean {
  return command.includes(` --${flag} `);
}

/** The interpreter is the bare word `node`, not an absolute interpreter path:
 *  an absolute path in first position needs PowerShell's `&` call operator, so
 *  it would break depending on which shell the orchestrator reaches for. The
 *  absolute script and project paths are what make the command runnable from
 *  any working directory; the interpreter does not need to be. */
function renderCommand(
  event: string,
  payload: SignalPayload,
  outcomeValues: Record<string, string>,
  input: CompletionCommandsInput,
): string {
  const parts = [
    'node', `"${input.scriptPath}"`, 'pipeline', 'signal',
    '--event', event,
    '--project-dir', `"${input.projectDir}"`,
  ];
  const omit = new Set(input.omit ?? []);
  for (const [flag, def] of Object.entries(payload)) {
    const outcomeValue = outcomeValues[flag];
    // A flag carrying an outcome-identifying value is applicable by definition —
    // it is what distinguishes this command from its siblings. Dropping it would
    // collapse two outcomes into the same command, so it outranks the omission.
    if (outcomeValue === undefined && isDropped(flag, def, omit)) continue;
    parts.push(`--${flag}`);
    const knownValue = input.known[flag];
    if (def.array) {
      parts.push(renderArraySkeleton(flag, def.item_keys ?? [], input.repoNames));
    } else if (outcomeValue !== undefined) {
      parts.push(outcomeValue);
    } else if (knownValue !== undefined) {
      parts.push(renderKnownValue(knownValue));
    } else {
      // Markers are quoted unconditionally rather than judging which values can
      // contain spaces — a needless pair of quotes costs nothing, an unquoted
      // multi-word substitution costs the whole signal.
      //
      // A JSON-valued flag takes single quotes, the same form the array skeleton
      // uses: JSON carries its own double quotes, and double-quoting the marker
      // would have the shell eat them, so the value reaching JSON.parse is no
      // longer JSON. Literal in bash and PowerShell 7+; see renderArraySkeleton
      // for the Windows PowerShell 5.1 exception both flags share. Everything
      // else keeps double quotes, which survive the apostrophes that free text
      // routinely carries.
      parts.push(def.json === true ? `'${marker(flag)}'` : `"${marker(flag)}"`);
    }
  }
  return parts.join(' ');
}

/** An outcome value is rendered verbatim, so it must be a single bare token.
 *  Anything else would need quoting the renderer does not apply, and a
 *  space-bearing value would be parsed as excess arguments and rejected before
 *  the handler runs — the hazard `renderKnownValue` exists to prevent. A
 *  whitelist, so every shell metacharacter is excluded by construction; the
 *  first character excludes `-` as well, which the parser would read as a flag. */
const BARE_TOKEN = /^[A-Za-z0-9._/][A-Za-z0-9._\-/]*$/;

/** An `alternate_outcomes[].values` entry must name a scalar flag the target
 *  event actually declares, and carry a value safe to render bare.
 *
 *  `renderCommand` reads outcome values by flag name and ignores anything it
 *  does not recognise, so a mistyped key — or one naming an array flag, whose
 *  skeleton branch never consults them — leaves the real flag standing as a
 *  `<fill-in: …>` marker: the declaration silently does nothing, and the two
 *  outcomes that were meant to differ no longer do.
 *
 *  The check lives here rather than in the loader because the loader parses one
 *  catalog file at a time and never sees the event an action names. */
function assertOutcomeValues(
  actionName: string,
  event: string,
  values: Record<string, string>,
  payload: SignalPayload,
): void {
  // The remedy differs by problem, so the trailing hint does too: a bad key wants
  // the list of flags it could have named, a bad value wants the shape it must take.
  const fail = (key: string, problem: string, hint: string): never => {
    throw new Error(
      `Action '${actionName}' sets alternate_outcomes value '${key}' on event '${event}', but ${problem}. ${hint}`,
    );
  };
  const validFlags = (): string => {
    const scalars = Object.entries(payload).filter(([, d]) => !d.array).map(([f]) => f);
    return `Valid flags: ${scalars.length > 0 ? scalars.join(', ') : '(none)'}.`;
  };
  for (const [key, value] of Object.entries(values)) {
    // hasOwn, not `payload[key] === undefined` — a key like `toString` resolves
    // through the prototype chain and would pass a plain undefined check while
    // still naming no declared flag.
    if (!Object.hasOwn(payload, key)) fail(key, 'that event declares no such flag', validFlags());
    if (payload[key]?.array) fail(key, 'that event declares it as an array flag, which takes no outcome value', validFlags());
    if (!BARE_TOKEN.test(value)) {
      fail(key, `'${value}' is not a bare token and would not survive the shell unquoted`,
        'An outcome value must be a single token of letters, digits, dot, underscore, slash or dash, not leading with a dash.');
    }
  }
}

/**
 * Render one runnable command per way the action can finish by signalling.
 *
 * Returns an empty array for a terminal action (`completion_event: null`) and
 * for an action another skill signals (`completion_signalled_by: 'skill'`) —
 * neither leaves the orchestrator a command to run.
 *
 * Flags follow the event's `signal_payload` declaration order. An
 * `alternate_outcomes[].values` entry identifies its own outcome only, so it
 * fills that entry's command and no other. `when` rides every entry when the
 * action has more than one outcome, and no entry when it has one.
 *
 * @throws when the action declares an event `payloads` carries no entry for, or
 *         an outcome sets a value on a flag that event does not declare, or one
 *         that would not survive the shell unquoted.
 */
export function buildCompletionCommands(input: CompletionCommandsInput): CompletionCommand[] {
  const { action } = input;
  if (action.completion_event === null) return [];
  if (action.completion_signalled_by === 'skill') return [];

  const outcomes: Array<{ event: string; when?: string; values: Record<string, string> }> = [
    { event: action.completion_event, when: action.completion_when, values: {} },
    ...(action.alternate_outcomes ?? []).map((o) => ({ event: o.event, when: o.when, values: o.values ?? {} })),
  ];

  return outcomes.map((outcome) => {
    const payload: SignalPayload | undefined = input.payloads[outcome.event];
    if (payload === undefined) {
      throw new Error(
        `Action '${action.name}' declares event '${outcome.event}' but no signal_payload was resolved for it.`,
      );
    }
    assertOutcomeValues(action.name, outcome.event, outcome.values, payload);
    const command = renderCommand(outcome.event, payload, outcome.values, input);
    return outcomes.length > 1 && outcome.when !== undefined
      ? { event: outcome.event, when: outcome.when, command }
      : { event: outcome.event, command };
  });
}

interface MarkerNote { flag: string; text: string }

/** The flags still standing as markers across every rendered command, in
 *  declaration order. A flag the engine already resolved, and a flag a command
 *  carries as its outcome-identifying value, are both already final — neither
 *  belongs in the guidance. A flag the command does not carry gets no note
 *  either: omission is silent, and a bullet naming a flag the orchestrator
 *  cannot see would send it looking for something that is not there. */
function collectMarkers(
  commands: CompletionCommand[],
  payloads: Record<string, SignalPayload>,
  known: Record<string, string>,
): MarkerNote[] {
  const notes = new Map<string, string>();
  for (const cmd of commands) {
    const payload: SignalPayload | undefined = payloads[cmd.event];
    for (const [flag, def] of Object.entries(payload ?? {})) {
      if (notes.has(flag) || flag in known || !carriesFlag(cmd.command, flag)) continue;
      if (def.array) {
        const keys = def.item_keys ?? [];
        const detail = cmd.command.includes(marker(flag))
          ? ` One object per repo, keys ${keys.map((k) => `\`${k}\``).join(', ')}.`
          : ' Every `name` is already correct — do not edit, add, or remove one.';
        notes.set(flag, `${def.description}${detail}`);
      } else if (cmd.command.includes(marker(flag))) {
        notes.set(flag, def.description);
      }
    }
  }
  return [...notes].map(([flag, text]) => ({ flag, text }));
}

/**
 * The block that replaces the old signal line in the composed prompt: how to
 * run the command the envelope carries, and what each remaining marker wants.
 *
 * It ships into every prompt on every tick, so it states only what the command
 * cannot state for itself.
 */
export function buildSignalGuidance(
  commands: CompletionCommand[],
  payloads: Record<string, SignalPayload>,
  known: Record<string, string>,
): string {
  if (commands.length === 0) return '';
  const lines = ['Signal completion by running the `command` from this envelope\'s `completion_commands`.'];
  if (commands.length > 1) {
    lines.push('Choose the entry whose `when` matches what happened.');
  }
  lines.push(
    'Everything outside the `<fill-in: …>` markers is already final: do not alter, recompute, ' +
    'or drop any of it, and leave every quote in place when you substitute.',
  );
  const markers = collectMarkers(commands, payloads, known);
  if (markers.length > 0) {
    lines.push('Substitute each marker:');
    for (const note of markers) lines.push(`- \`--${note.flag}\` — ${note.text}`);
  }
  return lines.join('\n');
}
