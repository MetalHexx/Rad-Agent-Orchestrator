/**
 * The harness vocabulary shared by every `session` verb that accepts or records
 * a `--harness` value. Documented here and nowhere else, per `session --help`.
 */
export const HARNESSES = ['claude', 'copilot'] as const;
export type Harness = (typeof HARNESSES)[number];
