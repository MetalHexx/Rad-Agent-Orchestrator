/**
 * The ambient-awareness verbosity level: how much of the session-start preamble
 * the user actually sees. Shared by the config reader, the session-context
 * renderer, and the writer subcommand so they never drift on what is valid.
 */
export type AmbientVerbosity = 'verbose' | 'minimal' | 'silent' | 'off';

export const AMBIENT_VERBOSITY_LEVELS: readonly AmbientVerbosity[] = ['verbose', 'minimal', 'silent', 'off'];

/**
 * Coerce an untrusted value (config file, CLI flag) to a known level. Anything
 * missing or unrecognized degrades to 'minimal' — the fresh-install default,
 * which is also what installs upgrading in place get since they carry no
 * ambient_awareness key at all.
 */
export function normalizeAmbientVerbosity(value: unknown): AmbientVerbosity {
  return (AMBIENT_VERBOSITY_LEVELS as readonly unknown[]).includes(value) ? (value as AmbientVerbosity) : 'minimal';
}
